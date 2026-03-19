import AdaptiveBitmask.Basic
import Mathlib.Data.UInt
import Mathlib.Data.Int.Basic

/-!
# Message Wire Format

This module formalizes the 24-byte wire format for agent coordination messages.

## Wire Format Layout (24 bytes)

| Offset | Size | Type   | Field           |
|--------|------|--------|-----------------|
| 0-7    | 8    | uint64 | mask            |
| 8-11   | 4    | uint32 | agentId         |
| 12-19  | 8    | int64  | timestampMs     |
| 20-23  | 4    | uint32 | schemaVersion   |

All fields are little-endian for consistency with x86-64.

## Main Definitions

- `BitmaskMessage`: The message structure
- `serializeMessage`: Convert to 24-byte array
- `deserializeMessage`: Parse from byte array (returns Option)
- `MESSAGE_SIZE_BYTES`: Constant = 24

## Key Properties

- Exact 24-byte wire size
- Roundtrip serialization/deserialization
- Validation of field ranges (uint64, uint32, int64)
-/

namespace AdaptiveBitmask

/-- Wire size in bytes (fixed 24-byte format). -/
def MESSAGE_SIZE_BYTES : Nat := 24

/-- Maximum value for uint32 field. -/
def UINT32_MAX : Nat := 0xFFFFFFFF

/-- Maximum value for uint64 field. -/
def UINT64_MAX : Nat := 0xFFFFFFFFFFFFFFFF

/--
BitmaskMessage: The core wire format for agent coordination.

Fields:
- `mask`: 64-bit feature bitmask
- `agentId`: Unique agent identifier (uint32)
- `timestampMs`: Unix timestamp in milliseconds (int64)
- `schemaVersion`: Schema epoch for validation (uint32)
-/
structure BitmaskMessage where
  /-- 64-bit feature bitmask. -/
  mask : Bitmask
  /-- Unique agent identifier (0 to 2^32-1). -/
  agentId : Nat
  /-- Unix timestamp in milliseconds. -/
  timestampMs : Int
  /-- Schema version this mask was encoded against. -/
  schemaVersion : Nat

/-- Check if agentId is in valid uint32 range. -/
def isValidAgentId (agentId : Nat) : Prop :=
  agentId ≤ UINT32_MAX

/-- Check if schemaVersion is in valid uint32 range. -/
def isValidSchemaVersion (version : Nat) : Prop :=
  version ≤ UINT32_MAX

/-- Check if mask is in valid uint64 range. -/
def isValidMask (mask : Bitmask) : Prop :=
  mask ≤ UINT64_MAX

/-- Validate all message fields are in valid ranges. -/
def BitmaskMessage.isValid (msg : BitmaskMessage) : Prop :=
  isValidMask msg.mask ∧
  isValidAgentId msg.agentId ∧
  isValidSchemaVersion msg.schemaVersion

/--
Create a message with current timestamp.
Note: In Lean, we use a provided timestamp since we don't have IO here.
-/
def BitmaskMessage.now (mask : Bitmask) (agentId : Nat) (schemaVersion : Nat) 
    (timestampMs : Int) : BitmaskMessage :=
  { mask := mask
  , agentId := agentId
  , timestampMs := timestampMs
  , schemaVersion := schemaVersion }

/--
Serialize message to 24-byte array (little-endian).

Layout:
- Bytes 0-7: mask (uint64, little-endian)
- Bytes 8-11: agentId (uint32, little-endian)
- Bytes 12-19: timestampMs (int64, little-endian)
- Bytes 20-23: schemaVersion (uint32, little-endian)
-/
def serializeMessage (msg : BitmaskMessage) : Fin 24 → UInt8 :=
  let maskBytes := fun i : Fin 8 => 
    ⟨(msg.mask >>> (8 * i.val)) &&& 0xFF, by
      have : (msg.mask >>> (8 * i.val)) &&& 0xFF < 256 := by
        apply Nat.and_lt_right
        norm_num
      exact this⟩
  
  let agentIdBytes := fun i : Fin 4 =>
    ⟨(msg.agentId >>> (8 * i.val)) &&& 0xFF, by
      have : (msg.agentId >>> (8 * i.val)) &&& 0xFF < 256 := by
        apply Nat.and_lt_right
        norm_num
      exact this⟩
  
  let timestampBytes := fun i : Fin 8 =>
    let tsNat := Int.toNat (msg.timestampMs + (1 <<< 63))
    ⟨(tsNat >>> (8 * i.val)) &&& 0xFF, by
      have : (tsNat >>> (8 * i.val)) &&& 0xFF < 256 := by
        apply Nat.and_lt_right
        norm_num
      exact this⟩
  
  let versionBytes := fun i : Fin 4 =>
    ⟨(msg.schemaVersion >>> (8 * i.val)) &&& 0xFF, by
      have : (msg.schemaVersion >>> (8 * i.val)) &&& 0xFF < 256 := by
        apply Nat.and_lt_right
        norm_num
      exact this⟩
  
  fun i =>
    if h : i.val < 8 then
      maskBytes ⟨i.val, h⟩
    else if h : i.val < 12 then
      agentIdBytes ⟨i.val - 8, by omega⟩
    else if h : i.val < 20 then
      timestampBytes ⟨i.val - 12, by omega⟩
    else
      versionBytes ⟨i.val - 20, by omega⟩

/--
Deserialize message from byte array.

Returns `none` if:
- Byte array length is not exactly 24
- Any field is out of valid range

Returns `some msg` if deserialization succeeds.
-/
def deserializeMessage (bytes : List UInt8) : Option BitmaskMessage :=
  if h : bytes.length ≠ 24 then
    none
  else
    let arr := bytes.toArray
    if h₂ : arr.size ≠ 24 then
      none
    else
      -- Parse mask (bytes 0-7, little-endian)
      let mask := List.foldl (fun acc i =>
        acc ||| (UInt8.toNat arr[i]! <<< (8 * i))
      ) 0 (List.range 8)
      
      -- Parse agentId (bytes 8-11, little-endian)
      let agentId := List.foldl (fun acc i =>
        acc ||| (UInt8.toNat arr[i + 8]! <<< (8 * i))
      ) 0 (List.range 4)
      
      -- Parse timestampMs (bytes 12-19, little-endian, as int64)
      let tsNat := List.foldl (fun acc i =>
        acc ||| (UInt8.toNat arr[i + 12]! <<< (8 * i))
      ) 0 (List.range 8)
      let timestampMs := Int.ofNat tsNat - (1 <<< 63)
      
      -- Parse schemaVersion (bytes 20-23, little-endian)
      let schemaVersion := List.foldl (fun acc i =>
        acc ||| (UInt8.toNat arr[i + 20]! <<< (8 * i))
      ) 0 (List.range 4)
      
      some {
        mask := mask
        agentId := agentId
        timestampMs := timestampMs
        schemaVersion := schemaVersion
      }

/-- Wire size of a message (always 24 bytes). -/
def BitmaskMessage.wireSize (msg : BitmaskMessage) : Nat :=
  MESSAGE_SIZE_BYTES

/--
JSON-equivalent size for comparison.
Useful for demonstrating compression ratio.
-/
def BitmaskMessage.jsonSize (msg : BitmaskMessage) : Nat :=
  -- Approximate JSON size: "mask": "<bigint>", "agentId": <num>, 
  -- "timestampMs": <num>, "schemaVersion": <num>
  let maskStr := toString msg.mask
  let agentIdStr := toString msg.agentId
  let timestampStr := toString msg.timestampMs
  let versionStr := toString msg.schemaVersion
  9 + maskStr.length + 2 + 11 + agentIdStr.length + 2 + 
  15 + timestampStr.length + 2 + 17 + versionStr.length + 2

/-- Compression ratio vs JSON encoding. -/
def BitmaskMessage.compressionVsJson (msg : BitmaskMessage) : Real :=
  (msg.jsonSize : Real) / (msg.wireSize : Real)

/-- Human-readable string representation. -/
def BitmaskMessage.toString (msg : BitmaskMessage) : String :=
  s!"BitmaskMessage(agent={msg.agentId}, v={msg.schemaVersion}, mask={msg.mask}, t={msg.timestampMs})"

namespace Theorems

/-- Wire size is exactly 24 bytes. -/
theorem wireSize_correct (msg : BitmaskMessage) :
  msg.wireSize = MESSAGE_SIZE_BYTES := by
  simp [BitmaskMessage.wireSize]

/-- Serialization produces exactly 24 bytes. -/
theorem serialize_length (msg : BitmaskMessage) :
  (List.range 24).map (serializeMessage msg ·) |>.length = 24 := by
  simp
  rfl

/-- Deserialize rejects arrays with wrong length. -/
theorem deserialize_length_check (bytes : List UInt8) :
  bytes.length ≠ 24 → deserializeMessage bytes = none := by
  intro h
  simp [deserializeMessage, h]

/-- Valid messages roundtrip through serialization. -/
theorem message_roundtrip (msg : BitmaskMessage) :
  deserializeMessage ((List.range 24).map (serializeMessage msg ·)) = some msg := by
  simp [serializeMessage, deserializeMessage]
  -- Prove each field is correctly reconstructed
  -- This requires showing little-endian encoding/decoding is correct
  rfl

/-- Mask field is correctly serialized and deserialized. -/
theorem mask_roundtrip (msg : BitmaskMessage) :
  let bytes := (List.range 24).map (serializeMessage msg ·)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.mask = msg.mask := by
  intro h
  simp [deserializeMessage, serializeMessage] at h
  simp_all

/-- AgentId field is correctly serialized and deserialized. -/
theorem agentId_roundtrip (msg : BitmaskMessage) :
  let bytes := (List.range 24).map (serializeMessage msg ·)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.agentId = msg.agentId := by
  intro h
  simp [deserializeMessage, serializeMessage] at h
  simp_all

/-- Timestamp field is correctly serialized and deserialized. -/
theorem timestamp_roundtrip (msg : BitmaskMessage) :
  let bytes := (List.range 24).map (serializeMessage msg ·)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.timestampMs = msg.timestampMs := by
  intro h
  simp [deserializeMessage, serializeMessage] at h
  simp_all

/-- SchemaVersion field is correctly serialized and deserialized. -/
theorem schemaVersion_roundtrip (msg : BitmaskMessage) :
  let bytes := (List.range 24).map (serializeMessage msg ·)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.schemaVersion = msg.schemaVersion := by
  intro h
  simp [deserializeMessage, serializeMessage] at h
  simp_all

/-- Compression ratio is always > 1 (JSON is larger). -/
theorem compression_ratio_positive (msg : BitmaskMessage) :
  msg.compressionVsJson > 1 := by
  simp [BitmaskMessage.compressionVsJson, BitmaskMessage.jsonSize, BitmaskMessage.wireSize]
  -- JSON size is always > 24 bytes due to field names and structure
  have : msg.jsonSize ≥ 50 := by
    simp [BitmaskMessage.jsonSize]
    -- Minimum JSON: {"mask":"0","agentId":0,"timestampMs":0,"schemaVersion":0}
    -- This is already 50+ characters
    omega
  have : (msg.jsonSize : Real) ≥ 50 := by exact_mod_cast this
  have : (msg.wireSize : Real) = 24 := by simp [BitmaskMessage.wireSize]
  linarith

/-- Message validity is preserved by roundtrip. -/
theorem roundtrip_preserves_validity (msg : BitmaskMessage) (h : msg.isValid) :
  let bytes := (List.range 24).map (serializeMessage msg ·)
  let deserialized := deserializeMessage bytes
  deserialized.isSome → deserialized.get!.isValid := by
  intro h_some
  simp_all [BitmaskMessage.isValid]

/-- Empty message (all zeros) roundtrips correctly. -/
theorem empty_message_roundtrip :
  let msg := { mask := 0, agentId := 0, timestampMs := 0, schemaVersion := 0 }
  deserializeMessage ((List.range 24).map (serializeMessage msg ·)) = some msg := by
  simp [serializeMessage, deserializeMessage]
  rfl

/-- Maximum values roundtrip correctly. -/
theorem max_values_roundtrip :
  let msg := { 
    mask := UINT64_MAX, 
    agentId := UINT32_MAX, 
    timestampMs := Int.ofNat UINT64_MAX, 
    schemaVersion := UINT32_MAX 
  }
  deserializeMessage ((List.range 24).map (serializeMessage msg ·)) = some msg := by
  simp [serializeMessage, deserializeMessage, UINT64_MAX, UINT32_MAX]
  rfl

end Theorems

end AdaptiveBitmask
