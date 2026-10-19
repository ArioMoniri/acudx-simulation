"""External capacity providers for the AcuDx gateway.

* :mod:`server.providers.lambda_cloud` — typed async client for the Lambda
  Cloud public API (https://cloud.lambda.ai/api/v1).
* :mod:`server.providers.gpu_worker` — on-demand GPU worker manager (launch on
  demand, reap when idle, daily budget cap, SQLite cost ledger).
"""
