# Trading tips library

This library checks for opportunities to make money by buying/selling [Obyte bonded stablecoins](https://ostable.org) when the price of a token is away from the target price.

Use it in your trading bots or for notifications.

## Usage

```js
const tradingTips = require('trading-tips');

// get all tips available now
const all_tips = await tradingTips.getAllTips();

// get tips available on a specific AA only
const all_tips = await tradingTips.getTipsByAA('26XAPPPTTYRIOSYNCUV3NS2H57X5LZLJ');

// be notified about new opportunities that result from new requests that move the price
tradingTips.subscribeToRequests(tips => {
	console.log('new tips', tips);
}, 10 * 1000);

// be notified about new opportunities that result from oracle price change
tradingTips.subscribeToOracleUpdates(tips => {
	console.log('new tips', tips);
}, 10 * 1000);

// be notified about all new opportunities
tradingTips.subscribe(tips => {
	console.log('new tips', tips);
}, 10 * 1000);

```

The `tip` object is a trading recommendation that looks like
```js
{
	aa: 'Z7GNZCFDEWFKYOO6OIAZN7GH7DEKDHKA',
	action: 'buy',
	token_role: 'T1',
	token: 'GRB',
	reserve_token: 'GBYTE',
	current_price: 281.98184269925434,
	target_price: 289.44005973691606,
	price_difference_percentage: 2.644928115324155,
	max_amount: 2.148281867
}
```
Here, `action` is the recommended trade against token `token`, `max_amount` is the amount (in `token`) to buy/sell that would fully restore the peg, `current_price` is the price per token when buying/selling a small amount of `token` (10% of `max_amount`), `target_price` is the price per token after the peg is restored.

The trading recommendations are not financial advice, use at your own risk.
