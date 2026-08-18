# Deploy Runbook

Steps for a routine deploy. Pushed once at setup time; its snapshot is then
removed by the driver to demonstrate the **Occupied** state and the "Adopt page"
recovery button.

1. Freeze the queue.
2. Run migrations.
3. Unfreeze.
