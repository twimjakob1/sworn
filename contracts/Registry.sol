// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICoin {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// The system a claim or a sworn statement is about.
/// It answers one question: did the statement read true at a given time?
interface ISystem {
    function readsTrueAt(uint256 time) external view returns (bool);
}

/// The registry of claims, sworn statements, checks and checkers.
/// The poster of a claim pays a fee in coins. A checker with coins at stake records a finding.
/// Anyone may challenge the finding for seven days; the system is read again as it stood on the
/// day of the finding. A false finding costs the checker half its stake.
/// An issuer can post a sworn statement with a bond in coins for a stated term. A statement
/// shown false during its term forfeits the bond: one fifth to the reporter, the rest to the pool.
/// This code has no owner. It can add to the community pool and can take nothing out of it.
contract Registry {
    uint256 private constant COIN = 10 ** 18;
    uint256 public constant MIN_CHECKER_STAKE = 10_000 * COIN;
    uint256 public constant MIN_CLAIM_FEE = 20 * COIN;
    uint256 public constant FEE_POOL_PCT = 20;
    uint256 public constant OPEN_PERIOD = 30 days;
    uint256 public constant CHALLENGE_PERIOD = 7 days;
    uint256 public constant CHALLENGE_BOND = 100 * COIN;
    uint256 public constant SLASH_PCT = 50;
    uint256 public constant MIN_STATEMENT_BOND = 10_000 * COIN;
    uint256 public constant MIN_TERM = 30 days;
    uint256 public constant MAX_TERM = 365 days;
    uint256 public constant REPORT_BOND = 100 * COIN;
    uint256 public constant REPORTER_PCT = 20;
    uint256 private constant READ_GAS = 200_000;

    enum State { None, Open, Attested, Final, Withdrawn, InForce, Refused, Broken, Honored }

    struct Record {
        bool isStatement;
        bool finding;
        bool overturned;
        State state;
        address poster;
        address customer;
        address system;
        address checker;
        address challenger;
        uint256 fee;
        uint256 bond;
        uint256 term;
        uint256 postedAt;
        uint256 attestedAt;
        uint256 endsAt;
    }

    address public immutable pool;
    address private immutable binder;
    ICoin public coin;

    mapping(address => bool) public founderLinked;
    mapping(address => bool) public isChecker;
    mapping(address => uint256) public stakeOf;
    mapping(address => uint256) public openWork;
    mapping(uint256 => Record) private records;

    uint256 public recordCount;
    uint256 public totalStaked;
    uint256 public feesInEscrow;
    uint256 public bondsInEscrow;
    uint256 public independentChecks;

    event ClaimPosted(uint256 indexed id, address indexed poster, address customer, address system, string statement, uint256 fee);
    event StatementPosted(uint256 indexed id, address indexed issuer, address system, string subject, string statement, uint256 bond, uint256 fee, uint256 term);
    event Withdrawn(uint256 indexed id);
    event Attested(uint256 indexed id, address indexed checker, bool finding, string evidence);
    event FindingOverturned(uint256 indexed id, address indexed checker, address indexed challenger, uint256 penalty);
    event ChallengeFailed(uint256 indexed id, address indexed checker, address indexed challenger);
    event CheckFinal(uint256 indexed id, bool finding, address feePaidTo, uint256 feeToPool, bool independent);
    event StatementChecked(uint256 indexed id, bool finding, uint256 inForceThrough, address feePaidTo, uint256 feeToPool, bool independent);
    event StatementBroken(uint256 indexed id, address indexed reporter, uint256 toReporter, uint256 toPool);
    event ReportFailed(uint256 indexed id, address indexed reporter);
    event StatementHonored(uint256 indexed id);

    constructor(address pool_, address[] memory founderLinked_) {
        require(pool_ != address(0), "zero address");
        pool = pool_;
        binder = msg.sender;
        for (uint256 i = 0; i < founderLinked_.length; i++) founderLinked[founderLinked_[i]] = true;
    }

    /// The full record of one claim or sworn statement.
    function recordOf(uint256 id) external view returns (Record memory) {
        return records[id];
    }

    /// Names the coin, once. The account that deployed the registry does this at launch
    /// and has no other power here.
    function bind(ICoin coin_) external {
        require(msg.sender == binder, "deployer only");
        require(address(coin) == address(0), "already bound");
        require(address(coin_) != address(0), "zero address");
        coin = coin_;
    }

    function _take(uint256 amount) private {
        require(coin.transferFrom(msg.sender, address(this), amount), "transfer failed");
    }

    function _pay(address to, uint256 amount) private {
        if (amount > 0) require(coin.transfer(to, amount), "transfer failed");
    }

    /// Reads the system as it stood at a given time. A system that fails to answer reads false.
    function _read(address system, uint256 time) private view returns (bool) {
        (bool ok, bytes memory out) = system.staticcall{gas: READ_GAS}(abi.encodeCall(ISystem.readsTrueAt, (time)));
        return ok && out.length == 32 && abi.decode(out, (uint256)) == 1;
    }

    // ---- checkers ----

    function registerChecker(uint256 amount) external {
        require(!isChecker[msg.sender], "already registered");
        require(amount >= MIN_CHECKER_STAKE, "stake too low");
        isChecker[msg.sender] = true;
        stakeOf[msg.sender] = amount;
        totalStaked += amount;
        _take(amount);
    }

    function addStake(uint256 amount) external {
        require(isChecker[msg.sender], "not a checker");
        stakeOf[msg.sender] += amount;
        totalStaked += amount;
        _take(amount);
    }

    function unstake() external {
        require(isChecker[msg.sender], "not a checker");
        require(openWork[msg.sender] == 0, "unfinished checks");
        uint256 stake = stakeOf[msg.sender];
        isChecker[msg.sender] = false;
        stakeOf[msg.sender] = 0;
        totalStaked -= stake;
        _pay(msg.sender, stake);
    }

    // ---- claims and sworn statements ----

    function postClaim(address customer, address system, string calldata statement, uint256 fee) external returns (uint256 id) {
        require(bytes(statement).length > 0 && system != address(0), "statement and system required");
        require(customer != msg.sender, "same party");
        require(fee >= MIN_CLAIM_FEE, "fee too low");
        id = ++recordCount;
        Record storage r = records[id];
        r.state = State.Open;
        r.poster = msg.sender;
        r.customer = customer;
        r.system = system;
        r.fee = fee;
        r.postedAt = block.timestamp;
        feesInEscrow += fee;
        _take(fee);
        emit ClaimPosted(id, msg.sender, customer, system, statement, fee);
    }

    function postStatement(address system, string calldata subject, string calldata statement, uint256 bond, uint256 fee, uint256 term) external returns (uint256 id) {
        require(bytes(subject).length > 0 && bytes(statement).length > 0 && system != address(0), "subject, statement and system required");
        require(bond >= MIN_STATEMENT_BOND, "bond too low");
        require(fee >= MIN_CLAIM_FEE, "fee too low");
        require(term >= MIN_TERM && term <= MAX_TERM, "term out of range");
        id = ++recordCount;
        Record storage r = records[id];
        r.isStatement = true;
        r.state = State.Open;
        r.poster = msg.sender;
        r.system = system;
        r.fee = fee;
        r.bond = bond;
        r.term = term;
        r.postedAt = block.timestamp;
        feesInEscrow += fee;
        bondsInEscrow += bond;
        _take(bond + fee);
        emit StatementPosted(id, msg.sender, system, subject, statement, bond, fee, term);
    }

    /// A record no checker has taken up can be withdrawn by its poster after 30 days.
    /// The fee and any bond return in full.
    function withdraw(uint256 id) external {
        Record storage r = records[id];
        require(r.state == State.Open, "not open");
        require(msg.sender == r.poster, "poster only");
        require(block.timestamp >= r.postedAt + OPEN_PERIOD, "waiting period running");
        r.state = State.Withdrawn;
        feesInEscrow -= r.fee;
        bondsInEscrow -= r.bond;
        _pay(r.poster, r.fee + r.bond);
        emit Withdrawn(id);
    }

    function attest(uint256 id, bool finding, string calldata evidence) external {
        Record storage r = records[id];
        require(r.state == State.Open, "not open");
        require(isChecker[msg.sender] && stakeOf[msg.sender] >= MIN_CHECKER_STAKE, "stake too low");
        require(msg.sender != r.poster && msg.sender != r.customer, "party to the claim");
        require(bytes(evidence).length > 0, "evidence required");
        r.state = State.Attested;
        r.checker = msg.sender;
        r.finding = finding;
        r.attestedAt = block.timestamp;
        openWork[msg.sender] += 1;
        emit Attested(id, msg.sender, finding, evidence);
    }

    /// Anyone but the checker may dispute a finding inside the window by posting a bond.
    /// The finding is judged against the system as it stood when the finding was made.
    function challenge(uint256 id) external {
        Record storage r = records[id];
        require(r.state == State.Attested, "not attested");
        require(block.timestamp < r.attestedAt + CHALLENGE_PERIOD, "window closed");
        require(msg.sender != r.checker, "own finding");
        require(!r.overturned, "already overturned");
        _take(CHALLENGE_BOND);
        bool actual = _read(r.system, r.attestedAt);
        if (actual != r.finding) {
            uint256 stake = stakeOf[r.checker];
            uint256 penalty = (stake * SLASH_PCT) / 100;
            uint256 toChallenger = penalty / 2;
            stakeOf[r.checker] = stake - penalty;
            totalStaked -= penalty;
            r.finding = actual;
            r.overturned = true;
            r.challenger = msg.sender;
            _pay(msg.sender, CHALLENGE_BOND + toChallenger);
            _pay(pool, penalty - toChallenger);
            emit FindingOverturned(id, r.checker, msg.sender, penalty);
        } else {
            _pay(r.checker, CHALLENGE_BOND);
            emit ChallengeFailed(id, r.checker, msg.sender);
        }
    }

    /// Closes a check after the challenge window and settles the fee. Anyone may call it.
    function finalize(uint256 id) external {
        Record storage r = records[id];
        require(r.state == State.Attested, "not attested");
        require(block.timestamp >= r.attestedAt + CHALLENGE_PERIOD, "window open");
        uint256 toPool = (r.fee * FEE_POOL_PCT) / 100;
        address feePaidTo = r.overturned ? r.challenger : r.checker;
        bool independent = !founderLinked[r.poster] && !founderLinked[r.customer] && !founderLinked[r.checker];
        if (independent && !r.overturned) independentChecks += 1;
        openWork[r.checker] -= 1;
        feesInEscrow -= r.fee;
        if (!r.isStatement) {
            r.state = State.Final;
            emit CheckFinal(id, r.finding, feePaidTo, toPool, independent);
        } else if (r.finding) {
            r.state = State.InForce;
            r.endsAt = block.timestamp + r.term;
            emit StatementChecked(id, true, r.endsAt, feePaidTo, toPool, independent);
        } else {
            r.state = State.Refused;
            bondsInEscrow -= r.bond;
            _pay(r.poster, r.bond);
            emit StatementChecked(id, false, 0, feePaidTo, toPool, independent);
        }
        _pay(feePaidTo, r.fee - toPool);
        _pay(pool, toPool);
    }

    /// During the term anyone may report that a statement no longer reads true.
    /// A statement that reads false forfeits its bond. One that still reads true costs
    /// the reporter its report bond, paid to the issuer.
    function reportBreach(uint256 id) external {
        Record storage r = records[id];
        require(r.state == State.InForce, "not in force");
        require(block.timestamp <= r.endsAt, "term ended");
        if (_read(r.system, block.timestamp)) {
            require(coin.transferFrom(msg.sender, r.poster, REPORT_BOND), "transfer failed");
            emit ReportFailed(id, msg.sender);
            return;
        }
        uint256 toReporter = (r.bond * REPORTER_PCT) / 100;
        r.state = State.Broken;
        bondsInEscrow -= r.bond;
        _pay(msg.sender, toReporter);
        _pay(pool, r.bond - toReporter);
        emit StatementBroken(id, msg.sender, toReporter, r.bond - toReporter);
    }

    /// After the term anyone may close a statement that stood throughout. The bond returns to the issuer.
    function closeStatement(uint256 id) external {
        Record storage r = records[id];
        require(r.state == State.InForce, "not in force");
        require(block.timestamp > r.endsAt, "term running");
        r.state = State.Honored;
        bondsInEscrow -= r.bond;
        _pay(r.poster, r.bond);
        emit StatementHonored(id);
    }
}

/// Practice chain only: a stand-in for a real system. It records each change with its time
/// and answers what it showed at any past time.
contract PracticeSystem is ISystem {
    uint256[] private times;
    bool[] private values;

    function set(bool value) external {
        times.push(block.timestamp);
        values.push(value);
    }

    function readsTrueAt(uint256 time) external view returns (bool) {
        for (uint256 i = times.length; i > 0; i--) {
            if (times[i - 1] <= time) return values[i - 1];
        }
        return false;
    }
}

/// Practice chain only: a system that refuses to answer.
contract PracticeSilentSystem {
    function readsTrueAt(uint256) external pure returns (bool) {
        revert("no answer");
    }
}
