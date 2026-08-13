# 04 — Diagrams

Data flow diagrams, use case diagrams, sequence diagrams and state machines. All Mermaid; render in GitHub, VS Code, or any Mermaid viewer.

---

## 1. Data flow diagrams

### 1.1 Level 0 — context

```mermaid
flowchart TB
    CS["Club Secretary<br/>Treasurer · President"]
    ADRR["ADRR / LDRR"]
    ASR["Assessor"]
    PIME["PIME Chair<br/>DES · DRR"]
    MBR["Club Member"]

    DIS(("District<br/>Information<br/>System"))

    MAIL["Email / WhatsApp<br/>gateway"]
    OBJ["Object storage<br/>+ CDN"]
    RI["Rotary International<br/>(manual reference)"]

    CS -->|activity reports · membership events · finance| DIS
    DIS -->|scorecard · feedback · deadlines · receipts| CS
    ADRR -->|cluster activities · visit reports · ADRR assessment| DIS
    DIS -->|cluster dashboard · club standing| ADRR
    ASR -->|parameter scores · comments| DIS
    DIS -->|assessment queue with evidence| ASR
    PIME -->|framework · periods · goals · appointments| DIS
    DIS -->|standings · goal progress · exports · alerts| PIME
    MBR -->|attendance confirmation · privacy settings| DIS
    DIS -->|own profile · club activity| MBR

    DIS -->|notifications| MAIL
    DIS <-->|media · documents| OBJ
    PIME -.->|RI club/member IDs · TRF receipts<br/>entered manually| DIS
    DIS -.->|SPC reference URLs| RI
```

The dotted lines matter. RI provides no general-purpose API for this data, so integration is **reference capture and reconciliation**, never a live feed. Any plan that assumes otherwise will fail in month three.

### 1.2 Level 1 — major processes

```mermaid
flowchart TB
    subgraph EXT[" "]
        direction LR
        U1["Club officers"]
        U2["District officers"]
        U3["Assessors"]
    end

    P1["1.0<br/>Capture &<br/>validate"]
    P2["2.0<br/>Govern access<br/>& terms"]
    P3["3.0<br/>Derive<br/>metrics"]
    P4["4.0<br/>Score &<br/>assess"]
    P5["5.0<br/>Track goals"]
    P6["6.0<br/>Notify &<br/>export"]

    D1[("D1 Organisation<br/>clubs · years · affiliations")]
    D2[("D2 People<br/>persons · appointments")]
    D3[("D3 Membership events")]
    D4[("D4 Activities")]
    D5[("D5 Finance")]
    D6[("D6 Assessment")]
    D7[("D7 Goals")]
    D8[("D8 Audit")]

    U1 --> P1
    U2 --> P2
    U3 --> P4

    P1 --> D3 & D4 & D5
    P1 --> D8
    P2 --> D2
    P2 -.->|permission context| P1
    P2 -.->|permission context| P4

    D3 & D4 & D5 --> P3
    D1 --> P3
    P3 -->|metric values| P4
    P3 -->|actuals| P5

    D6 --> P4
    P4 --> D6
    P4 --> P6
    P5 --> D7
    D7 --> P6

    P6 --> U1
    P6 --> U2
    P4 -->|scorecard + feedback| U1
```

Process 3.0 is the layer the incumbent system has never had: everything downstream of capture. Note that 3.0 reads from the data stores and writes nothing — metric derivation is pure. That property is what makes the scoring engine testable.

### 1.3 Level 2 — assessment scoring (process 4.0)

```mermaid
flowchart TB
    T1["Trigger:<br/>nightly cron · data write · manual"]
    P41["4.1<br/>Select stale<br/>assessments"]
    P42["4.2<br/>Load framework<br/>criteria"]
    P43["4.3<br/>Resolve metrics<br/>per criterion"]
    P44["4.4<br/>Apply thresholds<br/>and bands"]
    P45["4.5<br/>Persist score<br/>+ evidence"]
    P46["4.6<br/>Queue assessor<br/>items"]
    P47["4.7<br/>Aggregate total<br/>& rank in tier"]
    P48["4.8<br/>Publish to club"]

    D6[("D6 Assessment")]
    DM[("D3/D4/D5<br/>source data")]
    REG["Resolver registry<br/>(code)"]
    ASR["Assessor"]
    CLB["Club"]

    T1 --> P41 --> D6
    D6 --> P42 --> P43
    REG -.->|named functions| P43
    DM --> P43
    P43 -->|"AUTO / HYBRID"| P44 --> P45
    P43 -->|"ASSESSOR / HYBRID"| P46 --> ASR
    ASR -->|"score + comment"| P45
    P45 --> D6
    P45 --> P47 --> D6
    P47 --> P48 --> CLB
    CLB -.->|dispute| D6
```

`4.3` is the only place source data is read for scoring, and `REG` is a code registry — never SQL in the database.

---

## 2. Use case diagrams

### 2.1 Club-level actors

```mermaid
flowchart LR
    SEC(("Club<br/>Secretary"))
    TRE(("Club<br/>Treasurer"))
    PRE(("Club<br/>President"))
    MEM(("Club<br/>Member"))

    UC1["Submit activity report"]
    UC2["Record membership event"]
    UC3["Maintain club roster"]
    UC4["Upload club documents"]
    UC5["Record income / expenditure"]
    UC6["Maintain club budget"]
    UC7["Record member dues"]
    UC8["Record TRF contribution"]
    UC9["View club scorecard"]
    UC10["Raise score dispute"]
    UC11["Maintain club profile"]
    UC12["Confirm own attendance"]
    UC13["Manage privacy settings"]
    UC14["View own profile"]

    SEC --> UC1 & UC2 & UC3 & UC4 & UC9
    TRE --> UC5 & UC6 & UC7 & UC8 & UC9
    PRE --> UC9 & UC10 & UC11 & UC4
    MEM --> UC12 & UC13 & UC14 & UC9
```

### 2.2 District-level actors

```mermaid
flowchart LR
    ADRR(("ADRR"))
    ASR(("Assessor"))
    PIME(("PIME Chair"))
    DES(("DES"))
    TRD(("District<br/>Treasurer"))
    DRR(("DRR"))

    U20["Report cluster activity"]
    U21["Log official visit"]
    U22["Score ADRR parameter"]
    U23["Score assigned parameter"]
    U24["Leave improvement comment"]
    U25["Author assessment framework"]
    U26["Open / close period"]
    U27["Assign assessors"]
    U28["Finalise assessments"]
    U29["Manage district goals"]
    U30["View standings"]
    U31["Manage clubs"]
    U32["Manage positions"]
    U33["Manage appointments"]
    U34["Roll over Rotary Year"]
    U35["Issue dues invoices"]
    U36["Reconcile payments"]
    U37["Export data"]
    U38["Resolve dispute"]

    ADRR --> U20 & U21 & U22 & U30
    ASR --> U23 & U24
    PIME --> U25 & U26 & U27 & U28 & U29 & U30 & U37 & U38
    DES --> U31 & U32 & U33 & U34 & U37
    TRD --> U35 & U36
    DRR --> U30 & U28 & U37
```

---

## 3. Sequence diagrams

### 3.1 Offline-tolerant activity submission (UC-01)

```mermaid
sequenceDiagram
    autonumber
    actor S as Secretary
    participant UI as React client
    participant Q as IndexedDB outbox
    participant SW as Service worker
    participant API as API
    participant DB as PostgreSQL
    participant OBJ as Object storage
    participant JOB as Worker

    S->>UI: Select activity type
    UI->>UI: Render fields from type config
    S->>UI: Complete form + attach photo
    UI->>UI: Generate UUID, compress image
    UI->>Q: Persist submission

    alt Online
        Q->>API: POST /activities (idempotent on UUID)
        API->>API: Validate (Zod + type config + period open)
        API->>OBJ: Store original
        API->>DB: INSERT activity
        API->>JOB: enqueue media.process
        API->>DB: flag club_assessments stale
        API-->>UI: 201 Created
        UI->>Q: Remove from outbox
        JOB->>OBJ: Write thumb + display variants
    else Offline
        UI-->>S: "Saved — will sync"
        Note over SW: background sync registered
        SW->>API: Retry on reconnect
        API-->>SW: 201 or 409 (already exists)
        SW->>Q: Remove from outbox
    end
```

Step 4 is why UUIDs are client-generated. Retry after an ambiguous failure is safe: the server either creates the row or recognises it already has it. Without this, a dropped connection produces duplicate reports — a defect visible on the incumbent system's own public feed today.

### 3.2 Nightly assessment recomputation (UC-04)

```mermaid
sequenceDiagram
    autonumber
    participant CRON as pg-boss cron
    participant ENG as Scoring engine
    participant DB as PostgreSQL
    participant REG as Resolver registry
    participant NOT as Notifications

    CRON->>ENG: assessment.recompute (02:00 EAT)
    ENG->>DB: SELECT club_assessments WHERE is_stale
    loop each stale assessment
        ENG->>DB: Load locked framework criteria
        loop each criterion
            alt evaluation_mode = AUTO or HYBRID
                ENG->>REG: resolve(resolver_key, ctx)
                REG->>DB: Aggregate query (raw SQL)
                DB-->>REG: metric value
                REG-->>ENG: value + evidence
                ENG->>ENG: Apply threshold / bands / tier
                ENG->>DB: UPSERT assessment_scores
            else evaluation_mode = ASSESSOR
                ENG->>DB: Ensure assessor queue item exists
            end
        end
        ENG->>DB: Recompute total, clear is_stale
    end
    ENG->>DB: Rank clubs within tier
    ENG->>NOT: Enqueue "score updated" for changed clubs
```

### 3.3 Rotary Year rollover (UC-06)

```mermaid
sequenceDiagram
    autonumber
    actor DES
    participant API
    participant JOB as Rollover job
    participant DB

    DES->>API: POST /admin/rollover {dryRun: true}
    API->>JOB: Execute in transaction, rollback at end
    JOB->>DB: Compute closing rosters, tiers, affiliations
    JOB-->>API: Diff report (no writes committed)
    API-->>DES: Preview: N clubs, tier changes, expiring appointments

    DES->>DES: Review
    DES->>API: POST /admin/rollover {dryRun: false, confirm: token}
    API->>JOB: Execute for real
    JOB->>DB: BEGIN
    JOB->>DB: Lock prior district_year (is_locked = true)
    JOB->>DB: Deactivate prior-year appointments
    JOB->>DB: Recalculate tiers from closing rosters
    JOB->>DB: Carry affiliations forward as unconfirmed
    JOB->>DB: Open new district_year (is_current = true)
    JOB->>DB: COMMIT
    JOB-->>DES: Completion report + audit entry
```

Dry run is not a nicety. This operation touches every club and every appointment, runs once a year, and is therefore the least-tested code path in the system on the day it matters most.

---

## 4. State machines

### 4.1 Club assessment

```mermaid
stateDiagram-v2
    [*] --> PENDING: period opens
    PENDING --> AUTO_SCORED: engine computes auto criteria
    AUTO_SCORED --> UNDER_REVIEW: all assessor criteria scored
    AUTO_SCORED --> AUTO_SCORED: data changes → is_stale → recompute
    UNDER_REVIEW --> FINALISED: PIME Chair finalises
    FINALISED --> DISPUTED: club raises dispute in window
    DISPUTED --> FINALISED: dispute resolved
    FINALISED --> [*]: dispute window closes
```

Note the self-loop: an assessment recomputes freely until it is finalised. After finalisation, only a dispute can change it, and every change is audited.

### 4.2 Assessment period

```mermaid
stateDiagram-v2
    [*] --> SCHEDULED
    SCHEDULED --> OPEN: start date reached
    OPEN --> CLOSED: submission deadline passes
    CLOSED --> FINALISED: all assessments finalised
    FINALISED --> [*]
    note right of CLOSED
        No new evidence accepted.
        Scoring and disputes continue.
    end note
```

### 4.3 Assessment framework

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> DRAFT: edit parameters and criteria
    DRAFT --> PUBLISHED: validate totals, publish
    PUBLISHED --> LOCKED: first period opens
    PUBLISHED --> DRAFT: withdraw (no periods opened)
    LOCKED --> ARCHIVED: year ends
    ARCHIVED --> [*]
    note right of LOCKED
        Immutable. A mid-year rubric change
        requires a new version, and scores
        already awarded are never recomputed
        against different rules.
    end note
```

### 4.4 Activity verification

```mermaid
stateDiagram-v2
    [*] --> UNVERIFIED: submitted
    UNVERIFIED --> VERIFIED: assessor confirms
    UNVERIFIED --> QUERIED: assessor requests clarification
    QUERIED --> UNVERIFIED: club responds
    UNVERIFIED --> REJECTED: not a valid activity
    REJECTED --> UNVERIFIED: club appeals
    VERIFIED --> [*]
```

`QUERIED` is the state the incumbent system lacks entirely — the district's own note asked *"where can PIME leave comments for improvement?"* This is the answer, and it is what converts a write-only reporting portal into a two-way system.

### 4.5 Dues invoice

```mermaid
stateDiagram-v2
    [*] --> UNPAID: invoice issued
    UNPAID --> PARTIAL: payment < balance
    PARTIAL --> PARTIAL: further payment
    PARTIAL --> PAID: balance cleared
    UNPAID --> PAID: paid in full
    UNPAID --> WAIVED: district waives
    PAID --> [*]
    WAIVED --> [*]
```