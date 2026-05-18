# Use Cases exist even when trivial

Every business operation has a dedicated Use Case module in `src/application/`, even when the implementation is a single-line delegation to a port. Pattern consistency across all operations outweighs line-count minimization — contributors (human and AI) know exactly where to look for any business operation without guessing whether it lives in the command or the application layer.
