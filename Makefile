.PHONY: serve stop tidy package help

DIST_NAME := myclaude-$(shell date +%Y%m%d).zip
PORT := 8000

help:
	@echo "myclaude — Claude Code usage stats dashboard"
	@echo ""
	@echo "  make serve     start static server on :$(PORT) and open browser (foreground; Ctrl-C to stop)"
	@echo "  make stop      kill any tracked server started via 'make serve' (only if you backgrounded it)"
	@echo "  make tidy      lint web/ + check trailing whitespace"
	@echo "  make package   zip web/ into output/$(DIST_NAME) for static hosting"

serve:
	@echo "Serving on http://localhost:$(PORT) — Ctrl-C to stop"
	@(sleep 0.6 && (open http://localhost:$(PORT) || xdg-open http://localhost:$(PORT) 2>/dev/null || true)) &
	@cd web && python3 -m http.server $(PORT)

stop:
	@if [ -f .serve.pid ]; then kill $$(cat .serve.pid) 2>/dev/null; rm -f .serve.pid; echo "stopped"; else echo "no .serve.pid — not running via make"; fi

tidy:
	@echo "Running lint checks..."
	@if command -v npx >/dev/null 2>&1; then \
		npx --yes eslint web/ --ext .js,.html 2>/dev/null; \
	else \
		echo "npx not found — skipping JS lint"; \
	fi
	@echo "Checking for trailing whitespace..."
	@if grep -rn ' $$' web/ ; then echo "WARNING: trailing whitespace found"; else echo "No trailing whitespace."; fi
	@echo "Tidy complete."

package:
	@echo "Packaging web/ -> output/$(DIST_NAME)"
	@mkdir -p output
	@cd web && zip -r ../output/$(DIST_NAME) . --exclude '.DS_Store' --exclude '.git/*'
	@echo "Done: output/$(DIST_NAME)"
