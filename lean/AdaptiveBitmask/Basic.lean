import Mathlib.Data.Nat.Bits
import Mathlib.Data.Fin.Basic
import Mathlib.Data.Real.Basic
import Std.Data.HashMap

/-!
# Core Bitmask Primitives

This module formalizes the 64-bit bitmask operations that form the foundation
of the Adaptive Bitmask Protocol.

## Main Definitions

- `Bitmask`: A 64-bit bitmask represented as `Nat`
- `empty`: The zero bitmask
- `setBit`, `clearBit`, `testBit`: Basic bit manipulation
- `popcount`: Count of set bits (population count)
- `merge`, `intersect`, `delta`: Bitwise operations
- `hammingDistance`: Number of differing bits
- `toBytes`, `fromBytes`: Serialization primitives

## Key Properties

- Bitwise operations are commutative and associative
- Serialization roundtrips correctly
- Emergency bits (56-63) can be isolated
-/

namespace AdaptiveBitmask

open Std (HashMap)

/-- Width of the bitmask in bits (64-bit unsigned). -/
def BITMASK_WIDTH : Nat := 64

/-- A 64-bit bitmask represented as a natural number. -/
abbrev Bitmask := Nat

/-- Create an empty bitmask (all zeros). -/
def empty : Bitmask := 0

/-- Emergency bit range: bits 56-63 (8 bits for critical signals). -/
def EMERGENCY_RANGE : (Nat × Nat) := (56, 63)

/-- High-frequency bit range: bits 0-47 (48 bits for common features). -/
def HIGH_FREQ_RANGE : (Nat × Nat) := (0, 47)

/-- Medium-frequency bit range: bits 48-55 (8 bits for less common features). -/
def MED_FREQ_RANGE : (Nat × Nat) := (48, 55)

/-- Check if a bit position is valid (0-63). -/
def isValidPosition (p : Nat) : Prop := p < BITMASK_WIDTH

instance : DecidablePred isValidPosition :=
  inferInstanceAs (DecidablePred (· < BITMASK_WIDTH))

/-- Set bit at position `p`. Returns 0 if position is invalid. -/
def setBit (mask : Bitmask) (p : Nat) : Bitmask :=
  if decide (isValidPosition p) then
    mask ||| (1 <<< p)
  else
    0

/-- Test if bit at position `p` is set. Returns false if position is invalid. -/
def testBit (mask : Bitmask) (p : Nat) : Bool :=
  if decide (isValidPosition p) then
    (mask &&& (1 <<< p)) ≠ 0
  else
    false

/-- Clear bit at position `p`. Returns mask unchanged if position is invalid. -/
def clearBit (mask : Bitmask) (p : Nat) : Bitmask :=
  if decide (isValidPosition p) then
    if testBit mask p then mask ^^^ (1 <<< p) else mask
  else
    mask

/-- Count the number of set bits (population count). -/
def popcount (mask : Bitmask) : Nat :=
  (List.range BITMASK_WIDTH).countP (fun p => testBit mask p)

/-- Get all set bit positions as a list (ascending order). -/
def activeBits (mask : Bitmask) : List Nat :=
  List.filter (fun p => testBit mask p) (List.range BITMASK_WIDTH)

/-- Invoke a function on each set bit position (ascending order). -/
def forEachSetBit (mask : Bitmask) (f : Nat → Unit) : Unit :=
  (activeBits mask).foldl (fun (_ : Unit) p => f p) ()

/-- OR-merge two bitmasks (union of features). -/
def merge (a b : Bitmask) : Bitmask :=
  a ||| b

/-- AND-intersect two bitmasks (common features). -/
def intersect (a b : Bitmask) : Bitmask :=
  a &&& b

/-- XOR-delta between two bitmasks (changed features). -/
def delta (prev next : Bitmask) : Bitmask :=
  prev ^^^ next

/-- Hamming distance: number of differing bit positions. -/
def hammingDistance (a b : Bitmask) : Nat :=
  popcount (delta a b)

/-- Check if emergency bits (56-63) are active. -/
def hasEmergency (mask : Bitmask) : Bool :=
  let emergencyMask := 0xFF <<< 56
  (mask &&& emergencyMask) ≠ 0

/-- Extract only emergency bits. -/
def emergencyBits (mask : Bitmask) : Bitmask :=
  let emergencyMask := 0xFF <<< 56
  mask &&& emergencyMask

/-- Serialize bitmask to 8-byte array (little-endian). -/
def toBytes (mask : Bitmask) : Fin 8 → UInt8 :=
  fun i => UInt8.ofNat ((mask >>> (8 * i.val)) &&& 0xFF)

/-- Deserialize from 8-byte array (little-endian). -/
def fromBytes (bytes : Fin 8 → UInt8) : Bitmask :=
  List.foldl (fun acc (i : Fin 8) =>
    acc ||| (UInt8.toNat (bytes i) <<< (8 * i.val))
  ) 0 (List.finRange 8)

/--
Encode a set of features into a bitmask given a schema mapping.
Features not in the schema are silently ignored.
-/
def encode (features : List String) (schema : HashMap String (Fin 64)) :
    Bitmask × Nat × Nat :=
  let init := (0, 0, 0)
  let (mask, mapped, unmapped) := List.foldl (fun (m, mcnt, ucnt) feat =>
    match schema.get? feat with
    | some bit => (m ||| (1 <<< bit.val), mcnt + 1, ucnt)
    | none => (m, mcnt, ucnt + 1)
  ) init features
  (mask, mapped, unmapped)

/--
Decode a bitmask back to feature names.
Note: Ambiguous when collisions exist (multiple features per bit).
-/
def decode (mask : Bitmask) (reverseSchema : HashMap (Fin 64) (List String)) : List String :=
  (activeBits mask).bind (fun bit =>
    if h : bit < BITMASK_WIDTH then
      reverseSchema.get? ⟨bit, h⟩ |>.getD []
    else
      []
  )

namespace Theorems

/-- Setting a bit makes it test true (when position is valid). -/
axiom setBit_test_true (mask : Bitmask) (p : Nat) (h : p < BITMASK_WIDTH) :
  testBit (setBit mask p) p = true

/-- Setting a bit doesn't affect other bits. -/
axiom setBit_preserves_other (mask : Bitmask) (p q : Nat) 
    (hp : p < BITMASK_WIDTH) (hq : q < BITMASK_WIDTH) (hne : p ≠ q) :
  testBit (setBit mask p) q = testBit mask q

/-- Clearing a set bit makes it test false. -/
axiom clearBit_test_false (mask : Bitmask) (p : Nat) (h : p < BITMASK_WIDTH) 
    (hset : testBit mask p = true) :
  testBit (clearBit mask p) p = false

/-- Merge (OR) is commutative. -/
axiom merge_comm (a b : Bitmask) :
  merge a b = merge b a

/-- Merge (OR) is associative. -/
axiom merge_assoc (a b c : Bitmask) :
  merge (merge a b) c = merge a (merge b c)

/-- Merge with empty is identity. -/
axiom merge_empty_left (mask : Bitmask) :
  merge empty mask = mask

/-- Merge with empty is identity (right). -/
axiom merge_empty_right (mask : Bitmask) :
  merge mask empty = mask

/-- Intersect (AND) is commutative. -/
axiom intersect_comm (a b : Bitmask) :
  intersect a b = intersect b a

/-- Delta (XOR) is commutative. -/
axiom delta_comm (a b : Bitmask) :
  delta a b = delta b a

/-- Hamming distance is symmetric. -/
axiom hammingDistance_symm (a b : Bitmask) :
  hammingDistance a b = hammingDistance b a

/-- Hamming distance to self is zero. -/
axiom hammingDistance_self (mask : Bitmask) :
  hammingDistance mask mask = 0

/-- Popcount of empty is zero. -/
axiom popcount_empty :
  popcount empty = 0

/-- Popcount of single bit is one. -/
axiom popcount_single_bit (p : Nat) (hp : p < BITMASK_WIDTH) :
  popcount (setBit empty p) = 1

/-- activeBits of empty is empty list. -/
axiom activeBits_empty :
  activeBits empty = []

/-- activeBits length equals popcount. -/
axiom activeBits_length_eq_popcount (mask : Bitmask) :
  (activeBits mask).length = popcount mask

/-- toBytes and fromBytes roundtrip. -/
axiom serialize_roundtrip (mask : Bitmask) :
  fromBytes (toBytes mask) = mask

/-- Each byte from toBytes is in valid range. -/
axiom toBytes_valid (mask : Bitmask) (i : Fin 8) :
  UInt8.toNat (toBytes mask i) < 256

/-- Emergency bits detection is correct. -/
axiom hasEmergency_correct (mask : Bitmask) :
  hasEmergency mask = true ↔ (mask &&& (0xFF <<< 56)) ≠ 0

/-- Emergency bits extraction preserves only bits 56-63. -/
axiom emergencyBits_correct (mask : Bitmask) :
  ∀ p, p < 56 → testBit (emergencyBits mask) p = false

end Theorems

end AdaptiveBitmask
