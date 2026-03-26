#!/bin/bash
# Start Gemini CLI in tmux, serve via ttyd (interactive runtime only)
# CONTINUE_SESSION: 1 = continue most recent session (--resume)

GEMINI_ARGS="gemini --approval-mode yolo"
if [ -n "$LLM_MODEL" ]; then
    GEMINI_ARGS="$GEMINI_ARGS --model $LLM_MODEL"
fi
if [ "$CONTINUE_SESSION" = "1" ]; then
    GEMINI_ARGS="$GEMINI_ARGS --resume"
fi

tmux -u new-session -d -s gemini "$GEMINI_ARGS"
exec ttyd --writable -p "${PORT:-7681}" tmux attach -t gemini
