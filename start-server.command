#!/bin/bash
# Двойной клик в Finder: запускает сервер CG и не даёт Mac уснуть, пока окно открыто
cd "$(dirname "$0")"
caffeinate -dimsu node server.js
