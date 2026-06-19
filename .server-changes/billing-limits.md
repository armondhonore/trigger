---
area: webapp
type: feature
---

Add billing limits. Customers set a spend cap; when usage crosses it, billable
environments pause for a grace period, new triggers are rejected once it ends,
and a recovery flow resumes or cancels the queued backlog. Reconciliation keeps
the webapp converged to billing's state.
