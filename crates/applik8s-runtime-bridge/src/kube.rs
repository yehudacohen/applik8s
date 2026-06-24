use std::time::Duration;

use kube::runtime::controller::Action;

pub fn retry_after(duration: Duration) -> Action {
    Action::requeue(duration)
}
