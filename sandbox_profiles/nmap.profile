# ---- Nmap Safe (WORKING) ----

# Networking allowed
netfilter

# No raw sockets
caps.drop all

# Allow ONLY nmap binary
private-bin nmap

# Minimal isolation
private-tmp
private-dev
