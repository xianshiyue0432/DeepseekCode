use std::panic::{self, AssertUnwindSafe};

fn main() {
    let _ = panic::catch_unwind(AssertUnwindSafe(|| {
        tauri_build::build()
    }));
}
