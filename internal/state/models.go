// Package state defines the dual-graph domain model (AssetGraph +
// ExplorationGraph), the persistence Store interface, and its PostgreSQL and
// in-memory implementations. Both graphs are persisted so sessions can resume
// and every action remains auditable.
package state

import (
	"crypto/rand"
	"fmt"
	"time"
)

// ---- Enumerations -----------------------------------------------------------

// TaskStatus is the lifecycle state of a pentest task.
type TaskStatus string

const (
	TaskPending TaskStatus = "pending"
	TaskRunning TaskStatus = "running"
	TaskPaused  TaskStatus = "paused"
	TaskDone    TaskStatus = "done"
	TaskFailed  TaskStatus = "failed"
)

// Classification labels the risk category of an intent. Exploitation and
// exfiltration require a human approval gate before a worker may proceed.
type Classification string

const (
	ClassRecon        Classification = "recon"
	ClassEnumeration  Classification = "enumeration"
	ClassExploitation Classification = "exploitation"
	ClassExfiltration Classification = "exfiltration"
)

// RequiresApproval reports whether an intent of this classification must pass
// through the mandatory human-in-the-loop approval gate.
func (c Classification) RequiresApproval() bool {
	return c == ClassExploitation || c == ClassExfiltration
}

// Valid reports whether c is a known classification.
func (c Classification) Valid() bool {
	switch c {
	case ClassRecon, ClassEnumeration, ClassExploitation, ClassExfiltration:
		return true
	}
	return false
}

// IntentStatus is the lifecycle state of an intent in the frontier queue.
type IntentStatus string

const (
	IntentFrontier          IntentStatus = "frontier"
	IntentClaimed           IntentStatus = "claimed"
	IntentRunning           IntentStatus = "running"
	IntentBlockedOnApproval IntentStatus = "blocked_on_approval"
	IntentDone              IntentStatus = "done"
	IntentFailed            IntentStatus = "failed"
)

// AssetType categorizes an AssetGraph node.
type AssetType string

const (
	AssetHost       AssetType = "host"
	AssetService    AssetType = "service"
	AssetCredential AssetType = "credential"
	AssetVuln       AssetType = "vuln"
)

// ExplorationKind categorizes an ExplorationGraph node.
type ExplorationKind string

const (
	ExploreGoal    ExplorationKind = "goal"
	ExploreIntent  ExplorationKind = "intent"
	ExploreOutcome ExplorationKind = "outcome"
)

// ApprovalStatus is the decision state of an approval request.
type ApprovalStatus string

const (
	ApprovalPending  ApprovalStatus = "pending"
	ApprovalApproved ApprovalStatus = "approved"
	ApprovalDenied   ApprovalStatus = "denied"
)

// ---- Entities ---------------------------------------------------------------

// Task is a single authorized pentest engagement.
type Task struct {
	ID              string     `json:"id"`
	Objective       string     `json:"objective"`
	AuthorizedScope string     `json:"authorized_scope"` // rules of engagement
	Status          TaskStatus `json:"status"`
	Paused          bool       `json:"paused"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// Intent is a high-level action description dispatched by the Planner into the
// frontier queue and claimed by a Worker.
type Intent struct {
	ID             string         `json:"id"`
	TaskID         string         `json:"task_id"`
	Description    string         `json:"description"`
	Classification Classification `json:"classification"`
	Status         IntentStatus   `json:"status"`
	DedupKey       string         `json:"dedup_key"`
	ClaimedBy      string         `json:"claimed_by,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

// Asset is an AssetGraph node (discovered entity).
type Asset struct {
	ID         string         `json:"id"`
	TaskID     string         `json:"task_id"`
	Type       AssetType      `json:"type"`
	Key        string         `json:"key"` // e.g. "10.0.0.5", "10.0.0.5:22"
	Attributes map[string]any `json:"attributes"`
	CreatedAt  time.Time      `json:"created_at"`
}

// AssetEdge is a relationship between two AssetGraph nodes.
type AssetEdge struct {
	ID         string         `json:"id"`
	TaskID     string         `json:"task_id"`
	SrcAssetID string         `json:"src_asset_id"`
	DstAssetID string         `json:"dst_asset_id"`
	Relation   string         `json:"relation"`
	Attributes map[string]any `json:"attributes"`
}

// ExplorationNode is an ExplorationGraph node (investigation progress).
type ExplorationNode struct {
	ID         string          `json:"id"`
	TaskID     string          `json:"task_id"`
	Kind       ExplorationKind `json:"kind"`
	Label      string          `json:"label"`
	Status     string          `json:"status"` // pending|claimed|done|failed
	DedupKey   string          `json:"dedup_key"`
	Attributes map[string]any  `json:"attributes"`
	CreatedAt  time.Time       `json:"created_at"`
}

// ExplorationEdge connects two ExplorationGraph nodes.
type ExplorationEdge struct {
	ID       string `json:"id"`
	TaskID   string `json:"task_id"`
	SrcID    string `json:"src_id"`
	DstID    string `json:"dst_id"`
	Relation string `json:"relation"`
}

// Observation is a result written back by a Worker after executing an intent.
type Observation struct {
	ID        string         `json:"id"`
	TaskID    string         `json:"task_id"`
	IntentID  string         `json:"intent_id"`
	WorkerID  string         `json:"worker_id"`
	Content   map[string]any `json:"content"`
	CreatedAt time.Time      `json:"created_at"`
}

// Approval is a human-in-the-loop gate record for a sensitive intent.
type Approval struct {
	ID             string         `json:"id"`
	TaskID         string         `json:"task_id"`
	IntentID       string         `json:"intent_id"`
	Classification Classification `json:"classification"`
	Status         ApprovalStatus `json:"status"`
	Reason         string         `json:"reason,omitempty"`
	DecidedBy      string         `json:"decided_by,omitempty"`
	RequestedAt    time.Time      `json:"requested_at"`
	DecidedAt      *time.Time     `json:"decided_at,omitempty"`
}

// TodoItem is one entry of the planner's shared, multi-round todolist.
type TodoItem struct {
	Text string `json:"text"`
	Done bool   `json:"done"`
}

// Todolist is the planner's shared todolist for a given round. Successive
// rounds stabilize attack chains across planner cycles.
type Todolist struct {
	ID        string     `json:"id"`
	TaskID    string     `json:"task_id"`
	Round     int        `json:"round"`
	Items     []TodoItem `json:"items"`
	CreatedAt time.Time  `json:"created_at"`
}

// AuditEntry records a single traceable action taken by an agent or operator.
type AuditEntry struct {
	ID        string         `json:"id"`
	TaskID    string         `json:"task_id"`
	Actor     string         `json:"actor"`  // e.g. "planner", "worker:w1", "operator"
	Action    string         `json:"action"` // e.g. "dispatch_intent", "add_asset"
	Payload   map[string]any `json:"payload"`
	CreatedAt time.Time      `json:"created_at"`
}

// ---- Helpers ----------------------------------------------------------------

// NewID returns a random RFC-4122 version-4 UUID string. Uses crypto/rand to
// avoid an external dependency.
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failure is catastrophic; the caller cannot proceed safely.
		panic("state: crypto/rand failed: " + err.Error())
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
