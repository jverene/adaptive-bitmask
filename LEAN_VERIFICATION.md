# Lean Formal Verification Guide

This document describes the Lean 4 formal verification system for the adaptive-bitmask protocol.

## Overview

The Lean formalization verifies the mathematical foundations of the adaptive-bitmask protocol, including:

- **Bitmask primitives**: 64-bit operations, serialization
- **Schema management**: Collision probability, expected exclusions
- **Message format**: 24-byte wire format correctness
- **Coordinator**: Multi-agent aggregation properties
- **Arbiter**: Weighted scoring bounds, decision logic

## Quick Start

### Prerequisites

1. **Install elan (Lean version manager)**:
   ```bash
   curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh | sh
   ```

2. **Verify installation**:
   ```bash
   lean --version
   lake --version
   ```

### Building

```bash
# Build the Lean project
npm run lean:build

# Run formal verification tests
npm run lean:test

# Check code formatting
npm run lean:format:check

# Full verification (build + test)
npm run verify:math
```

## Project Structure

```
lean/
├── lakefile.toml          # Lean project configuration
├── lean-toolchain         # Lean version (v4.15.0)
├── AdaptiveBitmask/       # Core library
│   ├── Basic.lean         # Bitmask primitives
│   ├── Schema.lean        # Schema management & collision theory
│   ├── Message.lean       # 24-byte wire format
│   ├── Coordinator.lean   # Multi-agent aggregation
│   └── Arbiter.lean       # Scoring & decision logic
└── Tests/                 # Test modules (future)
```

## Verification Coverage

### TypeScript → Lean Mapping

| TypeScript Module | Lean Formalization | Status | Key Theorems |
|------------------|-------------------|--------|--------------|
| `bitmask.ts` | `Basic.lean` | ✅ Complete | `setBit_test_true`, `merge_comm`, `serialize_roundtrip` |
| `schema.ts` | `Schema.lean` | ✅ Complete | `collision_rate_80`, `expected_excluded_128` |
| `message.ts` | `Message.lean` | ✅ Complete | `message_roundtrip`, `wireSize_correct` |
| `coordinator.ts` | `Coordinator.lean` | ✅ Complete | `aggregate_comm`, `confidence_bounds` |
| `arbiter.ts` | `Arbiter.lean` | ✅ Complete | `raw_score_bounds`, `composite_score_bounds` |

### Proven Properties

#### Bitmask Primitives (`Basic.lean`)

```lean
-- Setting a bit makes it test true
theorem setBit_test_true (mask : Bitmask) (p : Nat) (h : p < 64) :
  testBit (setBit mask p) p = true

-- Merge (OR) is commutative
theorem merge_comm (a b : Bitmask) :
  merge a b = merge b a

-- Serialization roundtrip
theorem serialize_roundtrip (mask : Bitmask) :
  fromBytes (toBytes mask) = mask
```

#### Schema Management (`Schema.lean`)

```lean
-- Collision rate for m=80 features ≈ 0.712
theorem collision_rate_80 :
  |theoreticalCollisionRate 80 - 0.712| < 0.001

-- Expected excluded features for m=128 ≈ 72.52
theorem expected_excluded_128 :
  |expectedExcludedFeatures 128 - 72.52| < 0.01

-- Fingerprint is deterministic
theorem fingerprint_deterministic (state : SchemaState) :
  computeFingerprint state = computeFingerprint state
```

#### Message Format (`Message.lean`)

```lean
-- Wire size is exactly 24 bytes
theorem wireSize_correct (msg : BitmaskMessage) :
  msg.wireSize = MESSAGE_SIZE_BYTES

-- Deserialize rejects wrong length
theorem deserialize_length_check (bytes : List UInt8) :
  bytes.length ≠ 24 → deserializeMessage bytes = none

-- Valid messages roundtrip
theorem message_roundtrip (msg : BitmaskMessage) :
  deserializeMessage (serializeMessage msg) = some msg
```

#### Coordinator (`Coordinator.lean`)

```lean
-- Aggregation is commutative (order-independent)
theorem aggregate_comm (msgs1 msgs2 : List BitmaskMessage) :
  aggregate (msgs1 ++ msgs2) = aggregate (msgs2 ++ msgs1)

-- Confidence is bounded in [0, 1]
theorem confidence_bounds (messages : List BitmaskMessage) (p : Nat) :
  0 ≤ computeConfidence messages p ∧ computeConfidence messages p ≤ 1
```

#### Arbiter (`Arbiter.lean`)

```lean
-- Raw score is in [0, 1] for non-negative weights
theorem raw_score_bounds (config : ArbiterConfig) (mask : Bitmask)
    (h_nonneg : ∀ i, 0 ≤ config.weights i)
    (h_positive_sum : 0 < weightSum config) :
  0 ≤ weightedScore config mask ∧ weightedScore config mask ≤ 1

-- Composite score is in [0, 1]
theorem composite_score_bounds (rawScore confidenceScore : Real)
    (h_raw : 0 ≤ rawScore ∧ rawScore ≤ 1) 
    (h_conf : 0 ≤ confidenceScore ∧ confidenceScore ≤ 1) :
  0 ≤ compositeScore rawScore confidenceScore ∧ 
  compositeScore rawScore confidenceScore ≤ 1

-- Emergency override forces REJECT
theorem emergency_override_reject (config : ArbiterConfig) (mask : Bitmask) :
  config.emergencyOverride = true → 
  hasEmergency mask = true →
  (score config mask none).decision = Decision.REJECT
```

## Mathematical Formulas Verified

### Collision Probability

**Formula**: `P(collision) = 1 - (1 - 1/64)^(m-1)`

**Verified in Lean**:
```lean
def theoreticalCollisionRate (m : Nat) : Real :=
  1 - (1 - 1/64 : Real) ^ (m - 1)
```

**Reference points**:
- m=80: ≈ 0.712 (verified)
- m=128: ≈ 0.864 (verified)

### Expected Excluded Features

**Formula**: `E[excluded] = m - 64 * (1 - (1 - 1/64)^m)`

**Verified in Lean**:
```lean
def expectedExcludedFeatures (m : Nat) : Real :=
  m - 64 * (1 - (1 - 1/64 : Real) ^ m)
```

**Reference points**:
- m=80: ≈ 34.2 (verified)
- m=128: ≈ 72.52 (verified)

### Weighted Scoring

**Formula**: `ŝ = Σ(w_k · b_k) / Σ(w_k)`

**Verified in Lean**:
```lean
def weightedScore (config : ArbiterConfig) (mask : Bitmask) : Real :=
  let active := AdaptiveBitmask.activeBits mask
  let numerator := active.foldl (fun acc p => acc + config.weights ⟨p, by omega⟩) 0
  let denominator := weightSum config
  if denominator = 0 then 0 else numerator / denominator
```

**Properties verified**:
- Score bounded in [0, 1] for non-negative weights
- Monotonicity with respect to active bits
- Uniform weights give score = activeBits/64

### Composite Score

**Formula**: `ŝ_final = min(1.0, 0.6 * ŝ_raw + 0.4 * confidence)`

**Verified bounds**:
```lean
theorem composite_score_bounds (rawScore confidenceScore : Real)
    (h_raw : 0 ≤ rawScore ∧ rawScore ≤ 1) 
    (h_conf : 0 ≤ confidenceScore ∧ confidenceScore ≤ 1) :
  0 ≤ compositeScore rawScore confidenceScore ∧ 
  compositeScore rawScore confidenceScore ≤ 1
```

## CI/CD Integration

The Lean verification runs automatically on:

1. **Push to main/master** (when Lean files change)
2. **Pull requests** (when Lean files change)

### Workflow Steps

1. Cache Lean toolchain
2. Install elan and set toolchain version
3. Fetch Mathlib cache
4. Build Lean project (`lake build`)
5. Run tests (`lake test`)
6. Check formatting (`lake format --check`)

### Adding New Proofs

1. Create theorem in appropriate module:
   ```lean
   namespace Theorems
   
   theorem my_new_property (x : Nat) :
     -- statement
     := by
     -- proof
   ```

2. Build to check for errors:
   ```bash
   npm run lean:build
   ```

3. Run tests:
   ```bash
   npm run lean:test
   ```

## Using Placeholders for Incomplete Proofs

During development, you can use a temporary placeholder while iterating:

```lean
theorem incomplete_proof (x : Nat) : x = x := by
  admit  -- TODO: complete this proof
```

**Note**: The CI will fail if temporary proof placeholders remain. All proofs must be complete for merge.

## Dependencies

- **Mathlib**: The Lean 4 mathematical library
  - Provides: `Nat`, `Real`, `HashMap`, `Fin`, etc.
  - Installed automatically via `lake`

## Troubleshooting

### Build Errors

1. **Import errors**: Ensure all imports are from `Mathlib` or local modules
2. **Type errors**: Use `#check` to inspect types
3. **Timeout**: Complex proofs may need optimization

### Formatting Issues

```bash
# Auto-format all files
npm run lean:format

# Check if formatting is correct
npm run lean:format:check
```

### Cache Issues

```bash
# Clear Lean cache
cd lean
rm -rf .lake

# Rebuild
lake update
lake build
```

## Further Reading

- [Theorem Proving in Lean 4](https://leanprover.github.io/theorem_proving_in_lean4/)
- [Functional Programming in Lean](https://lean-lang.org/functional_programming_in_lean/)
- [Mathlib Documentation](https://leanprover-community.github.io/mathlib4_docs/)
- [Lean 4 Reference Manual](https://leanprover.github.io/lean4/doc/)

## Contributing

When adding new features to the TypeScript codebase:

1. **Identify mathematical properties** that need verification
2. **Add corresponding definitions** to the appropriate Lean module
3. **State and prove theorems** about the new definitions
4. **Update this documentation** with new coverage

## License

The Lean formalization is licensed under the same MIT license as the main project.
