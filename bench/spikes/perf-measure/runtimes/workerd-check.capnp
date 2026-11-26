using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [ (name = "main", worker = .worker) ],
  sockets = [ (name = "http", address = "127.0.0.1:8799", http = (), service = "main") ]
);
const worker :Workerd.Worker = (
  modules = [ (name = "worker", esModule = embed "workerd-check.mjs") ],
  compatibilityDate = "2026-11-01"
);
