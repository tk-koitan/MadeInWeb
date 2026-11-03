meshoptimizer 0.22.0（MIT, LICENSE.md）の展開処理。
- meshopt_decoder_reference.js … JavaScript だけの展開処理。sandbox/meshopt.js から使う（CSP で WebAssembly を動かせないため）
- meshopt_decoder.module.js … 公式の WebAssembly 版（今は使っていない。速さの比較用に残している）
圧縮する側（tools/vrm-slim.mjs --meshopt）は tools/lib/meshopt_encoder.module.js を使う。
