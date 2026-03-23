/**
 * NutriTrack – Firebase Cloud Functions
 *
 * These functions act as secure server-side proxies so that API keys for
 * Nutritionix and USDA are never exposed in the client bundle.
 *
 * Callable functions (client calls via httpsCallable):
 *   nutritionixBarcode  – premium barcode lookup via Nutritionix Track API
 *   nutritionixSearch   – premium food name search via Nutritionix Track API
 *   usdaBarcode         – free barcode/UPC lookup via USDA FoodData Central
 *   usdaSearch          – free food name search via USDA FoodData Central
 *
 * All functions require a signed-in Firebase user.
 * Nutritionix functions additionally require an active "pro" subscription
 * stored at Firestore path:  users/{uid}/subscription  { status: "active" }
 *
 * ── PAYMENT INTEGRATION (PLACEHOLDER) ────────────────────────────────────
 * When you are ready to accept payments, wire up Stripe here:
 *
 * 1. Install the "Run Payments with Stripe" Firebase Extension
 *    (firebase.google.com/products/extensions/stripe-firestore-stripe-payments)
 *    It writes { status: "active" | "canceled" | "past_due", ... } to
 *    users/{uid}/subscriptions/{subId}.
 *
 * 2. Replace the isPremium() helper below with a real Firestore query
 *    on the `subscriptions` sub-collection instead of the single document.
 *
 * 3. Add your price IDs and webhook secret to Firebase environment config:
 *    firebase functions:config:set stripe.secret="sk_..." stripe.webhook="whsec_..."
 * ─────────────────────────────────────────────────────────────────────────
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp }      = require('firebase-admin/app');
const { getFirestore }       = require('firebase-admin/firestore');
const fetch                  = require('node-fetch');

initializeApp();
const db = getFirestore();

// ── API KEYS ──────────────────────────────────────────────────────────────
// Store these in Firebase Secret Manager or environment config — never hard-code them.
// Set via: firebase functions:config:set nutritionix.app_id="..." nutritionix.app_key="..." usda.api_key="..."
// Access at runtime via process.env (set in Firebase console → Functions → Environment variables)

const NUTRITIONIX_APP_ID  = process.env.NUTRITIONIX_APP_ID  || '';
const NUTRITIONIX_APP_KEY = process.env.NUTRITIONIX_APP_KEY || '';
const USDA_API_KEY        = process.env.USDA_API_KEY        || 'DEMO_KEY'; // DEMO_KEY works with rate limits

// ── HELPERS ───────────────────────────────────────────────────────────────

/** Returns true if the calling user has an active Pro subscription. */
async function isPremium(uid) {
  // ── PLACEHOLDER ──────────────────────────────────────────────────────
  // Currently checks a manually-written document.  Replace this with a
  // real Stripe subscription check once payments are wired up.
  // Expected document shape: { status: "active" | "trialing" | "canceled" }
  // ─────────────────────────────────────────────────────────────────────
  const snap = await db.doc(`users/${uid}/subscription/status`).get();
  if (!snap.exists) return false;
  const { status } = snap.data();
  return status === 'active' || status === 'trialing';
}

/** Normalise a USDA food item into the same shape our client expects. */
function normaliseUsda(food) {
  const nutrients = food.foodNutrients || [];
  const get = (name) => {
    const n = nutrients.find(x => x.nutrientName === name);
    return n ? n.value || 0 : 0;
  };
  // USDA uses "Energy" for kcal and "Energy (Atwater General Factors)" for kJ
  const kcal100   = get('Energy');
  const carbs100  = get('Carbohydrate, by difference');
  const protein100 = get('Protein');
  const fat100    = get('Total lipid (fat)');
  return {
    source:   'usda',
    name:     food.description || 'Unknown',
    brand:    food.brandOwner || food.brandName || '',
    kcal100,
    carbs100,
    protein100,
    fat100,
    kcal:     Math.round(kcal100),
    carbs:    +carbs100.toFixed(1),
    protein:  +protein100.toFixed(1),
    fat:      +fat100.toFixed(1),
    servingLabel:  'per 100g',
    servingFactor: 1,
  };
}

/** Normalise a Nutritionix food item into the same shape our client expects. */
function normaliseNutritionix(food) {
  const servingGrams  = food.serving_weight_grams || 100;
  const factor        = servingGrams / 100;
  const kcal100       = (food.nf_calories           || 0) / factor;
  const carbs100      = (food.nf_total_carbohydrate || 0) / factor;
  const protein100    = (food.nf_protein             || 0) / factor;
  const fat100        = (food.nf_total_fat           || 0) / factor;
  return {
    source:   'nutritionix',
    name:     food.food_name   || 'Unknown',
    brand:    food.brand_name  || '',
    kcal100,
    carbs100,
    protein100,
    fat100,
    kcal:     Math.round(food.nf_calories           || 0),
    carbs:    +((food.nf_total_carbohydrate || 0)).toFixed(1),
    protein:  +((food.nf_protein             || 0)).toFixed(1),
    fat:      +((food.nf_total_fat           || 0)).toFixed(1),
    servingLabel:  food.serving_qty
      ? `per serving (${food.serving_qty} ${food.serving_unit})`
      : 'per serving',
    servingFactor: factor,
  };
}

// ── CALLABLE FUNCTIONS ────────────────────────────────────────────────────

/**
 * nutritionixBarcode
 * Premium barcode lookup. Requires active subscription.
 * Request:  { barcode: string }
 * Response: { food: NormalisedFood } | throws HttpsError
 */
exports.nutritionixBarcode = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

  const premium = await isPremium(request.auth.uid);
  if (!premium) throw new HttpsError('permission-denied', 'pro_required');

  const { barcode } = request.data;
  if (!barcode) throw new HttpsError('invalid-argument', 'barcode is required.');

  if (!NUTRITIONIX_APP_ID || !NUTRITIONIX_APP_KEY) {
    throw new HttpsError('internal', 'Nutritionix API keys not configured.');
  }

  const res = await fetch(
    `https://trackapi.nutritionix.com/v2/search/item?upc=${encodeURIComponent(barcode)}`,
    { headers: { 'x-app-id': NUTRITIONIX_APP_ID, 'x-app-key': NUTRITIONIX_APP_KEY } }
  );

  if (res.status === 404) throw new HttpsError('not-found', 'Product not found in Nutritionix.');
  if (!res.ok) throw new HttpsError('internal', `Nutritionix error ${res.status}`);

  const data = await res.json();
  const foods = data.foods || [];
  if (!foods.length) throw new HttpsError('not-found', 'Product not found in Nutritionix.');

  return { food: normaliseNutritionix(foods[0]) };
});

/**
 * nutritionixSearch
 * Premium food name search. Requires active subscription.
 * Request:  { query: string, limit?: number }
 * Response: { foods: NormalisedFood[] }
 */
exports.nutritionixSearch = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

  const premium = await isPremium(request.auth.uid);
  if (!premium) throw new HttpsError('permission-denied', 'pro_required');

  const { query, limit = 10 } = request.data;
  if (!query) throw new HttpsError('invalid-argument', 'query is required.');

  if (!NUTRITIONIX_APP_ID || !NUTRITIONIX_APP_KEY) {
    throw new HttpsError('internal', 'Nutritionix API keys not configured.');
  }

  const res = await fetch(
    `https://trackapi.nutritionix.com/v2/search/instant?query=${encodeURIComponent(query)}&branded=true&common=false&branded_type=1&claims=false&branded_region=1&locale=en_US&limit=${limit}`,
    { headers: { 'x-app-id': NUTRITIONIX_APP_ID, 'x-app-key': NUTRITIONIX_APP_KEY } }
  );

  if (!res.ok) throw new HttpsError('internal', `Nutritionix error ${res.status}`);

  const data  = await res.json();
  const items = [...(data.branded || []), ...(data.common || [])];
  return { foods: items.map(normaliseNutritionix) };
});

/**
 * usdaBarcode
 * Free barcode/UPC lookup via USDA FoodData Central.
 * Request:  { barcode: string }
 * Response: { food: NormalisedFood } | throws HttpsError not-found
 */
exports.usdaBarcode = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

  const { barcode } = request.data;
  if (!barcode) throw new HttpsError('invalid-argument', 'barcode is required.');

  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(barcode)}&api_key=${USDA_API_KEY}&pageSize=5`;
  const res  = await fetch(url);

  if (!res.ok) throw new HttpsError('internal', `USDA error ${res.status}`);

  const data = await res.json();
  // USDA doesn't have a direct UPC endpoint; filter by gtinUpc match
  const foods = (data.foods || []).filter(f => f.gtinUpc === barcode);
  if (!foods.length) throw new HttpsError('not-found', 'Product not found in USDA.');

  return { food: normaliseUsda(foods[0]) };
});

/**
 * usdaSearch
 * Free food name search via USDA FoodData Central.
 * Request:  { query: string, limit?: number }
 * Response: { foods: NormalisedFood[] }
 */
exports.usdaSearch = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

  const { query, limit = 20 } = request.data;
  if (!query) throw new HttpsError('invalid-argument', 'query is required.');

  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&api_key=${USDA_API_KEY}&pageSize=${limit}&dataType=Branded,SR%20Legacy,Foundation`;
  const res  = await fetch(url);

  if (!res.ok) throw new HttpsError('internal', `USDA error ${res.status}`);

  const data  = await res.json();
  const foods = (data.foods || []).filter(f => f.foodNutrients && f.foodNutrients.length);
  return { foods: foods.map(normaliseUsda) };
});
