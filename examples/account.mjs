import { Mintarex } from '@mintarex-official/node';

const mx = new Mintarex({
  apiKey: process.env.MINTAREX_API_KEY,
  apiSecret: process.env.MINTAREX_API_SECRET,
});

const [balances, fees, limits] = await Promise.all([
  mx.account.balances({ currency_type: 'crypto', include_empty: false }),
  mx.account.fees(),
  mx.account.limits(),
]);

console.log('Balances:', balances.balances.length, 'currencies');
console.log('Trading fee rate:', fees.trading_fee_rate);
console.log('Daily crypto withdrawal remaining:', limits.crypto_withdrawal?.remaining_daily);
