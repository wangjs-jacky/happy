# Upstream provenance

`vendor/agents-party` contains an unmodified backend subset of
[1gr14/agents-party](https://github.com/1gr14/agents-party) at commit
`af00afbd49b3235c2084cff9849ef12353073484` (MIT):

- `LICENSE`
- `src/core/{colors,crypto,dirs,errors,names,types}.ts`
- `src/registry/{registry,sqlite}.ts`
- `src/server/{api,wake}.ts`
- `src/store/{pool,sqlite-driver,store}.ts`

The files retain their original paths beneath `vendor/agents-party` and are
byte-for-byte copies. Paws-specific authentication, orchestration, assets, and
HTTP hosting live outside the vendor directory.

`src/server/protocol.ts` and the remote turn execution design are adapted from
the earlier private Paws consultation POC at
`packages/paws-consultation/src/{protocol,remoteAgent}.ts` in commit
`5310220857a88b662936af1f5a6f028d88b935ee`. No LangGraph consultation code is
copied.
