# One file per scorer

Each retrieval path (BM25, dense, future scorers) lives in its own file under `src/lib/`, even when the implementation is shallow. This makes adding a new scorer a predictable two-step process: create the file, wire it into `Effect.all`. File structure is the interface for contributors.
