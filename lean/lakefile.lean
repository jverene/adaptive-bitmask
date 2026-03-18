import Lake
open Lake DSL

package adaptive_bitmask where
  version := "v0.1.0"
  lean := "v4.15.0"

require mathlib from git
  "https://github.com/leanprover-community/mathlib4.git"

@[default_target]
lean_lib AdaptiveBitmask where
  root := `AdaptiveBitmask
  moreLeanOptions := #[
    ⟨`warningAsErrors, `true⟩
  ]

lean_lib AdaptiveBitmaskTests where
  root := `Tests
  globs := #[.submodules `AdaptiveBitmask]
  moreLeanOptions := #[
    ⟨`warningAsErrors, `true⟩
  ]
