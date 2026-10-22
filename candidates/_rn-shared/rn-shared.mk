# Shared make logic of the React Native family (expo, repack). Included by each RN candidate.mk; the guard makes
# repeated inclusion a no-op. GNU Make 3.81 compatible: no .ONESHELL, $(file ...), ::=, !=, pattern rules.
ifndef MB_RN_SHARED_MK
MB_RN_SHARED_MK := 1

MB_RN_SHARED_DIR := candidates/_rn-shared
MB_RN_SHARED_TESTS := test/domain.test.ts test/stream.test.ts test/session.test.ts

.PHONY: check-rn-shared

# Unit tests of the shared domain, stream and session logic (Node built-in test runner, no app build, no device).
check-rn-shared:
	cd $(MB_RN_SHARED_DIR)/ui && node --test $(MB_RN_SHARED_TESTS)

endif
