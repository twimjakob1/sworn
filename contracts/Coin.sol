// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// The source of the usage count the founder vault reads.
interface IUsage {
    function independentChecks() external view returns (uint256);
}

/// The founder vault. It pays the founder share in 36 slices.
/// A slice is paid when its date has arrived, the usage milestone is met,
/// and a public notice has stood for 30 days without a veto.
/// During the notice, coin owners can lock coins against the release. When the locked coins
/// reach 20% of the coins outside the founder, the vault, the community pool and the
/// distribution account, the release is blocked. Locked coins return to their owners afterward.
/// No function here changes the schedule, the founder address or the milestone.
contract FounderVault {
    uint256 public constant LOCK_MONTHS = 12;
    uint256 public constant SLICES = 36;
    uint256 public constant MONTH = 30 days;
    uint256 public constant NOTICE = 30 days;
    uint256 public constant CHECKS_PER_SLICE = 500;
    uint256 public constant VETO_PCT = 20;

    Coin public immutable coin;
    IUsage public immutable usage;
    address public immutable founder;
    address public immutable communityPool;
    address public immutable distribution;
    uint256 public immutable launchedAt;
    uint256 public immutable share;

    uint256 public slicesReleased;
    uint256 public noticeSlice;
    uint256 public noticeGivenAt;
    uint256 public noticeCount;
    uint256 public paidOut;
    uint256 public votingSupply;
    uint256 public vetoWeight;
    mapping(uint256 => mapping(address => uint256)) public lockedOf;

    event NoticeGiven(uint256 indexed slice, uint256 payableAfter);
    event SliceReleased(uint256 indexed slice, uint256 amount);
    event VetoLocked(uint256 indexed notice, address indexed owner, uint256 amount, uint256 vetoWeight);
    event ReleaseVetoed(uint256 indexed slice, uint256 vetoWeight, uint256 votingSupply);
    event VetoUnlocked(uint256 indexed notice, address indexed owner, uint256 amount);

    constructor(Coin coin_, IUsage usage_, address founder_, address communityPool_, address distribution_, uint256 share_) {
        coin = coin_;
        usage = usage_;
        founder = founder_;
        communityPool = communityPool_;
        distribution = distribution_;
        share = share_;
        launchedAt = block.timestamp;
    }

    function sliceAmount(uint256 n) public view returns (uint256) {
        uint256 base = share / SLICES;
        return n == SLICES ? share - base * (SLICES - 1) : base;
    }

    function opensAt(uint256 n) public view returns (uint256) {
        return launchedAt + (LOCK_MONTHS + n) * MONTH;
    }

    function checksNeeded(uint256 n) public pure returns (uint256) {
        return CHECKS_PER_SLICE * n;
    }

    function _requireEligible(uint256 n) private view {
        require(n >= 1 && n <= SLICES && n == slicesReleased + 1, "wrong slice");
        require(block.timestamp >= opensAt(n), "date not reached");
        require(usage.independentChecks() >= checksNeeded(n), "usage milestone not met");
    }

    /// Starts the 30-day public notice for the next slice.
    function giveNotice(uint256 n) external {
        require(msg.sender == founder, "founder only");
        require(noticeSlice == 0, "notice already open");
        _requireEligible(n);
        noticeSlice = n;
        noticeGivenAt = block.timestamp;
        noticeCount += 1;
        vetoWeight = 0;
        // Coins that can vote: every coin outside the founder, the unpaid founder share,
        // the community pool and the distribution account, counted when the notice is given.
        votingSupply = coin.totalSupply() - (share - paidOut) - coin.balanceOf(founder) - coin.balanceOf(communityPool) - coin.balanceOf(distribution);
        emit NoticeGiven(n, block.timestamp + NOTICE);
    }

    /// Locks coins against the release that is under notice. The founder, the community pool
    /// and the distribution account have no vote. The coins return through unlock.
    function lockVeto(uint256 amount) external {
        require(noticeSlice != 0 && block.timestamp < noticeGivenAt + NOTICE, "no notice open");
        require(msg.sender != founder && msg.sender != communityPool && msg.sender != distribution, "no vote");
        require(amount > 0, "amount required");
        lockedOf[noticeCount][msg.sender] += amount;
        vetoWeight += amount;
        require(coin.transferFrom(msg.sender, address(this), amount), "transfer failed");
        emit VetoLocked(noticeCount, msg.sender, amount, vetoWeight);
        if (vetoWeight * 100 >= VETO_PCT * votingSupply) {
            emit ReleaseVetoed(noticeSlice, vetoWeight, votingSupply);
            noticeSlice = 0;
        }
    }

    /// Returns coins locked under a notice once that notice has ended: by veto, by release,
    /// or by the end of its 30 days.
    function unlock(uint256 notice) external {
        bool open = notice == noticeCount && noticeSlice != 0 && block.timestamp < noticeGivenAt + NOTICE;
        require(!open, "notice period running");
        uint256 amount = lockedOf[notice][msg.sender];
        require(amount > 0, "nothing locked");
        lockedOf[notice][msg.sender] = 0;
        require(coin.transfer(msg.sender, amount), "transfer failed");
        emit VetoUnlocked(notice, msg.sender, amount);
    }

    /// Pays the slice to the founder once every condition is met. Anyone may call it.
    function release(uint256 n) external {
        require(n != 0 && noticeSlice == n, "no notice for this slice");
        require(block.timestamp >= noticeGivenAt + NOTICE, "notice period running");
        _requireEligible(n);
        slicesReleased = n;
        noticeSlice = 0;
        uint256 amount = sliceAmount(n);
        paidOut += amount;
        require(coin.transfer(founder, amount), "transfer failed");
        emit SliceReleased(n, amount);
    }
}

/// The coin. The whole supply is created once, at launch.
/// This code has no owner and no function to create, destroy, freeze, pause or replace anything.
contract Coin {
    string public constant name = "Sworn";
    string public constant symbol = "SWORN";
    uint8 public constant decimals = 18;
    uint256 public constant totalSupply = 1_000_000_000 * 10 ** 18;

    FounderVault public immutable founderVault;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(IUsage usage, address founder, address communityPool, address distribution) {
        require(founder != address(0) && communityPool != address(0) && distribution != address(0), "zero address");
        uint256 founderShare = totalSupply / 10;         // 10%
        uint256 poolShare = (totalSupply * 4) / 10;      // 40%
        founderVault = new FounderVault(this, usage, founder, communityPool, distribution, founderShare);
        _create(address(founderVault), founderShare);
        _create(communityPool, poolShare);
        _create(distribution, totalSupply - founderShare - poolShare); // 50%
    }

    function _create(address to, uint256 value) private {
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "allowance too low");
            allowance[from][msg.sender] = allowed - value;
        }
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) private {
        require(to != address(0), "zero address");
        uint256 balance = balanceOf[from];
        require(balance >= value, "balance too low");
        unchecked {
            balanceOf[from] = balance - value;
        }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

/// Practice chain only: a stand-in for the registry's count of independent verified checks.
contract PracticeUsage is IUsage {
    uint256 public independentChecks;

    function record(uint256 n) external {
        independentChecks += n;
    }
}
