import { Mintarex, QuoteExpiredError, InsufficientBalanceError } from '@mintarex/node';

const mx = new Mintarex({
  apiKey: process.env.MINTAREX_API_KEY,
  apiSecret: process.env.MINTAREX_API_SECRET,
});

try {
  const quote = await mx.rfq.quote({
    base: 'BTC',
    quote: 'USD',
    side: 'buy',
    amount: '0.01',
    amount_type: 'base',
  });
  console.log('Got quote', quote.quote_id, 'price', quote.price);

  // Auto-generated idempotency key means this call is safe to retry.
  const trade = await mx.rfq.accept(quote.quote_id);
  console.log('Trade filled:', trade.trade_id, trade.base_amount, trade.base);
} catch (err) {
  if (err instanceof QuoteExpiredError) {
    console.error('Quote expired — request a fresh one.');
  } else if (err instanceof InsufficientBalanceError) {
    console.error('Not enough funds to execute.');
  } else {
    throw err;
  }
}
