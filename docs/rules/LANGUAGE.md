# Architecture Language

Terms used to describe module quality and architectural patterns in pix.

## Module

Anything with an interface and an implementation — a function, a class, a file, a package, a service.

## Interface

Everything a caller must know to use the module: types, invariants, error modes, ordering constraints, configuration. Not just the type signature — also the expected behavior and failure modes.

## Implementation

The code inside the module that satisfies the interface.

## Depth

The leverage a module provides at its interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.

## Seam

Where an interface lives; a place behaviour can be altered without editing in place. The boundary between a caller and an implementation.

## Adapter

A concrete implementation satisfying an interface at a seam. Multiple adapters for the same interface confirm the seam is real.

## Leverage

What callers gain from a deep module — they express more intent with less code.

## Locality

What maintainers gain from a deep module — change, bugs, and knowledge are concentrated in one place rather than scattered across N callers.

## Deletion test

Imagine deleting the module. If complexity vanishes, it was a shallow pass-through. If complexity reappears across N callers, it was earning its keep — it is deep.

## One adapter = hypothetical seam. Two adapters = real seam.

A single implementation of an interface means the seam is hypothetical — it could be extracted but isn't tested. A second implementation confirms the seam is real and independently usable.
