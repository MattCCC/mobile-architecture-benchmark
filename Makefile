# Root entry points (GNU Make 3.81 compatible: no .ONESHELL, no $(file ...)).
# Work in progress: the harness targets (bench, report, compare, validate, ci, doctor) are added with the
# harness core. Candidate targets come from candidates/<id>/candidate.mk.

SHELL := /bin/sh
.DEFAULT_GOAL := help

.PHONY: help check check-fixtures audit-eligibility test-acceptance test-eligibility test-early-bench \
	acceptance-android acceptance-ios early-bench-android early-bench-ios

help:
	@echo "Targets:"
	@echo "  check              fixture, acceptance and early-bench unit tests"
	@echo "  check-fixtures     deterministic fixture generator self-test and checksums"
	@echo "  test-acceptance    unit tests of the artifact-bound acceptance contract"
	@echo "  audit-eligibility  report candidate readiness (use audit.mjs --manifest for a result set)"
	@echo "  test-eligibility   unit tests of fail-closed eligibility rules"
	@echo "  test-early-bench   unit tests of tools/early-bench"
	@echo "  acceptance-<p>     black-box acceptance of every built candidate on <p> = android | ios (receipts in"
	@echo "                     results/local/acceptance; ACCEPTANCE_CANDIDATES=a,b limits the set)"
	@echo "  early-bench-<p>    early session of every candidate with a valid receipt (RUN_ID, EARLY_BENCH_ARGS)"
	@echo "  check-<id>, build-<id>-android, build-<id>-ios   per candidate, see candidates/<id>/README.md"
	@echo "Candidates: $(sort $(MB_CANDIDATES))"

check: check-fixtures test-acceptance test-eligibility test-early-bench

check-fixtures:
	node fixtures/generator/selftest.mjs
	cd fixtures/v1 && shasum -a 256 -c SHA256SUMS

test-early-bench:
	node --test tools/early-bench/test/

test-acceptance:
	node --test tools/acceptance/test/*.test.mjs

audit-eligibility:
	node tools/eligibility/audit.mjs --repo .

test-eligibility:
	node --test tools/eligibility/test/*.test.mjs

-include $(wildcard candidates/*/candidate.mk)

# Acceptance needs the reference device running (AVD mobilebench_api37 / simulator mobilebench-iphone).
ACCEPTANCE_CANDIDATES ?= $(subst $(eval) ,$(comma),$(sort $(MB_CANDIDATES)))
comma := ,
RUN_ID ?= early-$(shell date +%Y%m%d-%H%M%S)

acceptance-android acceptance-ios: acceptance-%:
	@failed=; for c in $$(echo "$(ACCEPTANCE_CANDIDATES)" | tr ',' ' '); do \
		echo "== $$c ($*)"; node tools/acceptance/$*.mjs --candidate $$c || failed="$$failed $$c"; \
	done; test -z "$$failed" || { echo "acceptance failed:$$failed"; exit 1; }

early-bench-android early-bench-ios: early-bench-%:
	node tools/early-bench/session.mjs --platform $* --repo . --out results/local/sessions --artifacts results/local/frozen \
		--run-id $(RUN_ID) $$(node tools/acceptance/session-args.mjs --platform $*) $(EARLY_BENCH_ARGS)
