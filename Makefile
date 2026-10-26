# Root entry points (GNU Make 3.81 compatible: no .ONESHELL, no $(file ...)).
# Work in progress: the harness targets (bench, report, compare, validate, ci, doctor) are added with the
# harness core. Candidate targets come from candidates/<id>/candidate.mk.

SHELL := /bin/sh
.DEFAULT_GOAL := help

.PHONY: help check check-fixtures test-acceptance test-early-bench

help:
	@echo "Targets:"
	@echo "  check              fixture, acceptance and early-bench unit tests"
	@echo "  check-fixtures     deterministic fixture generator self-test and checksums"
	@echo "  test-acceptance    unit tests of the artifact-bound acceptance contract"
	@echo "  test-early-bench   unit tests of tools/early-bench"
	@echo "  check-<id>, build-<id>-android, build-<id>-ios   per candidate, see candidates/<id>/README.md"

check: check-fixtures test-acceptance test-early-bench

check-fixtures:
	node fixtures/generator/selftest.mjs
	cd fixtures/v1 && shasum -a 256 -c SHA256SUMS

test-early-bench:
	node --test tools/early-bench/test/

test-acceptance:
	node --test tools/acceptance/test/*.test.mjs

-include $(wildcard candidates/*/candidate.mk)
