#!/usr/bin/env node
/**
 * 綠界 ECPay CheckMacValue 演算法 self-test
 *
 * 用途：
 *   驗證 functions/_lib/ecpay.ts 的演算法是否正確。
 *   這支 .mjs 用 Node 內建 crypto 重新實作同樣演算法（無外部依賴），
 *   跑出來的 hash 跟 .ts 版（用 Web Crypto API）必須完全一致。
 *
 * 跑法：
 *   cd C:\Users\Derek\Desktop\taiwan-stock-scanner\taiwan-stock-scanner
 *   node scripts/test_ecpay_helper.mjs
 *
 * 關鍵驗證（Test 9 ⭐）：
 *   直接對綠界官方文件 https://developers.ecpay.com.tw/2902/ 的測試向量。
 *   過 = 演算法 100% 正確、可以進 Phase 2。
 *
 * ⚠️ 修改規則：
 *   這支 .mjs 跟 functions/_lib/ecpay.ts 的演算法必須 1:1 同步，改一邊另一邊也要改。
 */

import crypto from 'node:crypto'

// ───────────────────────────────────────────────────────────
// 演算法（複製自 functions/_lib/ecpay.ts，必須 1:1 一致）
// ───────────────────────────────────────────────────────────

function dotnetUrlEncode(str) {
  return encodeURIComponent(str)
    .replace(/%20/g, '+')
    .replace(/%21/g, '!')
    .replace(/%27/g, "'")
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%2A/g, '*')
    .replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())
}

function stringifyValue(v) {
  if (v === null || v === undefined) return ''
  return String(v)
}

function signEcpay(params, hashKey, hashIV) {
  const entries = Object.entries(params)
    .filter(([k, v]) => k !== 'CheckMacValue' && v !== null && v !== undefined)
    .map(([k, v]) => [k, stringifyValue(v)])
    .sort(([a], [b]) => {
      const al = a.toLowerCase()
      const bl = b.toLowerCase()
      if (al < bl) return -1
      if (al > bl) return 1
      return 0
    })

  const inner = entries.map(([k, v]) => `${k}=${v}`).join('&')
  const raw = `HashKey=${hashKey}&${inner}&HashIV=${hashIV}`
  const encoded = dotnetUrlEncode(raw).toLowerCase()
  const hash = crypto.createHash('sha256').update(encoded, 'utf8').digest('hex').toUpperCase()

  return { raw, encoded, hash }
}

// ───────────────────────────────────────────────────────────
// 測試輔助
// ───────────────────────────────────────────────────────────

let passCount = 0
let failCount = 0

function assertEq(label, actual, expected) {
  const ok = actual === expected
  const mark = ok ? '✓' : '✗'
  console.log(`  ${mark} ${label}`)
  if (!ok) {
    console.log(`      expected: ${expected}`)
    console.log(`      actual:   ${actual}`)
    failCount++
  } else {
    passCount++
  }
  return ok
}

function runTest(label, params, hashKey, hashIV, expectedEncoded) {
  console.log(`\n━━━ ${label} ━━━`)
  const { raw, encoded, hash } = signEcpay(params, hashKey, hashIV)
  console.log(`  raw     : ${raw}`)
  console.log(`  encoded : ${encoded}`)
  console.log(`  sha256  : ${hash}`)
  if (expectedEncoded !== undefined) {
    assertEq('encoded string matches expected', encoded, expectedEncoded)
  }
  return { raw, encoded, hash }
}

// ───────────────────────────────────────────────────────────
// Test 1：最簡 ASCII case
// ───────────────────────────────────────────────────────────

runTest(
  'Test 1：最簡 ASCII (HashKey=abc, A=1, HashIV=xyz)',
  { A: '1' },
  'abc',
  'xyz',
  'hashkey%3dabc%26a%3d1%26hashiv%3dxyz',
)

// ───────────────────────────────────────────────────────────
// Test 2：unsorted keys → case-insensitive 排序
// ───────────────────────────────────────────────────────────

runTest(
  'Test 2：unsorted keys → case-insensitive 排序',
  { Zebra: 'stripes', apple: 'red', MerchantID: '2000132' },
  'k',
  'v',
  'hashkey%3dk%26apple%3dred%26merchantid%3d2000132%26zebra%3dstripes%26hashiv%3dv',
)

// ───────────────────────────────────────────────────────────
// Test 3：中文 UTF-8
// ───────────────────────────────────────────────────────────

runTest(
  'Test 3：中文 UTF-8（TradeDesc=測試交易）',
  { TradeDesc: '測試交易' },
  'k',
  'v',
  'hashkey%3dk%26tradedesc%3d%e6%b8%ac%e8%a9%a6%e4%ba%a4%e6%98%93%26hashiv%3dv',
)

// ───────────────────────────────────────────────────────────
// Test 4：空格 → +
// ───────────────────────────────────────────────────────────

runTest(
  'Test 4：空格 → +（不是 %20）',
  { ItemName: 'apple pie' },
  'k',
  'v',
  'hashkey%3dk%26itemname%3dapple+pie%26hashiv%3dv',
)

// ───────────────────────────────────────────────────────────
// Test 5：! ' ( ) * 不編碼
// ───────────────────────────────────────────────────────────

runTest(
  "Test 5：! ' ( ) * 不編碼",
  { X: "a!b'c(d)e*f" },
  'k',
  'v',
  "hashkey%3dk%26x%3da!b'c(d)e*f%26hashiv%3dv",
)

// ───────────────────────────────────────────────────────────
// Test 6：ReturnURL
// ───────────────────────────────────────────────────────────

runTest(
  'Test 6：ReturnURL 含 :// 跟 /',
  { ReturnURL: 'https://example.com/cb' },
  'k',
  'v',
  'hashkey%3dk%26returnurl%3dhttps%3a%2f%2fexample.com%2fcb%26hashiv%3dv',
)

// ───────────────────────────────────────────────────────────
// Test 7：CheckMacValue 自己要被排除
// ───────────────────────────────────────────────────────────

const test7 = signEcpay(
  { A: '1', CheckMacValue: 'should_be_excluded', B: '2' },
  'k',
  'v',
)
console.log('\n━━━ Test 7：CheckMacValue 不算進簽章 ━━━')
console.log(`  raw     : ${test7.raw}`)
console.log(`  encoded : ${test7.encoded}`)
assertEq(
  '簽章字串不含 CheckMacValue',
  test7.encoded.includes('checkmacvalue'),
  false,
)

// ───────────────────────────────────────────────────────────
// Test 8：null/undefined 排除，空字串保留
// ───────────────────────────────────────────────────────────

const test8 = signEcpay(
  { A: '1', B: null, C: undefined, D: '', E: '2' },
  'k',
  'v',
)
console.log('\n━━━ Test 8：null/undefined 排除，空字串保留 ━━━')
console.log(`  raw     : ${test8.raw}`)
assertEq('null 被排除', test8.raw.includes('B='), false)
assertEq('undefined 被排除', test8.raw.includes('C='), false)
assertEq(
  '空字串保留',
  test8.raw.includes('D=&') || test8.raw.endsWith('D=&HashIV=v'),
  true,
)

// ───────────────────────────────────────────────────────────
// Test 9 ⭐：綠界官方文件測試向量（authoritative）
//
//   來源：https://developers.ecpay.com.tw/2902/
//   文件直接給了每一步中間值 + 最終 hash。
//   如果我們的演算法正確 → 算出來必須完全一致。
// ───────────────────────────────────────────────────────────

const officialExpectedEncoded =
  'hashkey%3dpwfhcqoqzgmho4w6%26choosepayment%3dall%26encrypttype%3d1%26itemname%3dapple+iphone+15%26merchantid%3d3002607%26merchanttradedate%3d2023%2f03%2f12+15%3a30%3a23%26merchanttradeno%3decpay20230312153023%26paymenttype%3daio%26returnurl%3dhttps%3a%2f%2fwww.ecpay.com.tw%2freceive.php%26totalamount%3d30000%26tradedesc%3d%e4%bf%83%e9%8a%b7%e6%96%b9%e6%a1%88%26hashiv%3dekrm7ift261dpevs'
const officialExpectedHash =
  '6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840'

const official = runTest(
  'Test 9 ⭐：綠界官方文件範例（authoritative）',
  {
    TradeDesc: '促銷方案',
    PaymentType: 'aio',
    MerchantTradeDate: '2023/03/12 15:30:23',
    MerchantTradeNo: 'ecpay20230312153023',
    MerchantID: '3002607',
    ReturnURL: 'https://www.ecpay.com.tw/receive.php',
    ItemName: 'Apple iphone 15',
    TotalAmount: '30000',
    ChoosePayment: 'ALL',
    EncryptType: '1',
  },
  'pwFHCqoQZGmho4w6',
  'EkRm7iFT261dpevs',
  officialExpectedEncoded,
)
assertEq(
  'sha256 完全等於綠界官方文件值',
  official.hash,
  officialExpectedHash,
)

// ───────────────────────────────────────────────────────────
// Test 10：訂閱建單參考 case（給 Phase 2 開發者看的範例）
// ───────────────────────────────────────────────────────────

const real = signEcpay(
  {
    MerchantID: '2000132',
    MerchantTradeNo: 'TS2605301930ABCD',
    MerchantTradeDate: '2026/05/30 19:30:00',
    PaymentType: 'aio',
    TotalAmount: 88,
    TradeDesc: 'TaiwanStockScanner Monthly',
    ItemName: 'Taiwan Stock Scanner VIP Monthly',
    ReturnURL: 'https://taiwan-stock-scanner.pages.dev/api/payment/ecpay-return',
    ChoosePayment: 'Credit',
    EncryptType: 1,
    PeriodAmount: 88,
    PeriodType: 'M',
    Frequency: 1,
    ExecTimes: 99,
    PeriodReturnURL: 'https://taiwan-stock-scanner.pages.dev/api/payment/ecpay-return',
  },
  '5294y06JbISpM5x9',
  'v77hoKGq4kWxNNIS',
)
console.log('\n━━━ Test 10：訂閱建單參考 case ━━━')
console.log(`  sha256  : ${real.hash}`)

// ───────────────────────────────────────────────────────────
// 總結
// ───────────────────────────────────────────────────────────

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`✓ ${passCount} pass   ✗ ${failCount} fail`)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

if (failCount > 0) {
  console.log('\n❌ 演算法有 bug，請檢查 dotnetUrlEncode / 排序邏輯')
  console.log('   修完後同步改 functions/_lib/ecpay.ts 跟這支 .mjs')
  process.exit(1)
} else {
  console.log('\n✅ 全部過！包含綠界官方文件 Test 9 ⭐')
  console.log('   演算法 100% 正確，可以進 Phase 2 開建單端點。')
  process.exit(0)
}
