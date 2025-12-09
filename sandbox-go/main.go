package main

import (
    "encoding/json"
    "log"
    "net/http"
    "time"
)

type Request struct {
    Tool   string `json:"tool"`
    Target string `json:"target"`
}

type Response struct {
    Tool      string `json:"tool"`
    Target    string `json:"target"`
    Output    string `json:"output"`
    Timestamp string `json:"timestamp"`
}

func execHandler(w http.ResponseWriter, r *http.Request) {
    var req Request

    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid json", http.StatusBadRequest)
        return
    }

    // Simulated sandbox execution
    output := "Sandboxed execution of " + req.Tool + " on " + req.Target

    res := Response{
        Tool:      req.Tool,
        Target:    req.Target,
        Output:    output,
        Timestamp: time.Now().Format(time.RFC3339),
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(res)
}

func main() {
    http.HandleFunc("/exec", execHandler)
    log.Println("Go sandbox listening on :9000")
    log.Fatal(http.ListenAndServe(":9000", nil))
}
