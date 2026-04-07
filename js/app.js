/**
 * Ragnarok Craft Breakdown — App Logic
 *
 * Flow:
 *   1. Load data/items.json → build itemsMap (id → item)
 *   2. Search input → filter items → show dropdown
 *   3. User selects item → renderRecipePanel(item)
 *   4. renderRecipePanel builds an ingredient tree via renderIngredientTree()
 *   5. Each craftable ingredient row has a breakdown toggle button
 *   6. Each row has a have-counter (−, typed value, +) to deduct owned materials
 *   7. Toggle / have changes update state maps → re-render panel
 *
 * Quantity math:
 *   renderIngredientTree(ingredients, multiplier, depth, parentKey)
 *   → fullQty      = ingredient.qty * multiplier   (total required)
 *   → have         = haveState.get(rowKey) || 0
 *   → effectiveQty = max(0, fullQty - have)         (still needed)
 *   → sub-tree receives effectiveQty as its multiplier, so deductions propagate
 *
 * Row identity (shared by breakdownState and haveState):
 *   parentKey + '|' + itemId + '|' + index
 */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let itemsMap = new Map();          // id → item object
let selectedItem = null;           // currently displayed item
const breakdownState  = new Map();  // rowKey → boolean (expanded?)
const haveState       = new Map();  // rowKey → number  (qty player already has)
const craftDecisions  = new Map();  // rowKey → explicit user choice: true=craft, false=skip/drop
                                    // when unset, default is: craft unless item.droppable
const recipeChoiceState = new Map(); // itemId or rowKey → recipe index (for multi-recipe items)

// ── Bootstrap ──────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('data/items.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    for (const item of data.items) {
      itemsMap.set(item.id, item);
    }

    setupSearch();
  } catch (err) {
    document.body.insertAdjacentHTML(
      'afterbegin',
      `<div style="color:#e07070;padding:16px;text-align:center">
        Failed to load items.json: ${escapeHtml(err.message)}
       </div>`
    );
  }
}

// ── Search ─────────────────────────────────────────────────────────────────
function setupSearch() {
  const input   = document.getElementById('search-input');
  const results = document.getElementById('search-results');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    renderSearchResults(q, results);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeResults(results);
      input.value = '';
      input.blur();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) closeResults(results);
  });
}

function renderSearchResults(query, listEl) {
  listEl.innerHTML = '';

  if (!query) {
    listEl.classList.remove('visible');
    return;
  }

  const matches = [...itemsMap.values()].filter(item =>
    item.name.toLowerCase().includes(query)
  );

  if (matches.length === 0) {
    listEl.innerHTML = '<li class="no-results">No items found</li>';
  } else {
    for (const item of matches) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="item-name">${escapeHtml(item.name)}</span>`;
      li.addEventListener('click', () => {
        selectItem(item, listEl);
      });
      listEl.appendChild(li);
    }
  }

  listEl.classList.add('visible');
}

function selectItem(item, listEl) {
  selectedItem = item;
  breakdownState.clear();
  haveState.clear();
  craftDecisions.clear();
  recipeChoiceState.clear();
  closeResults(listEl);
  document.getElementById('search-input').value = item.name;
  renderRecipePanel(item);
}

function closeResults(listEl) {
  listEl.classList.remove('visible');
  listEl.innerHTML = '';
}

// ── Recipe panel ───────────────────────────────────────────────────────────
function renderRecipePanel(item) {
  const panel = document.getElementById('recipe-panel');
  panel.innerHTML = '';
  panel.classList.add('visible');

  // Header
  const header = document.createElement('div');
  header.className = 'recipe-header';
  const titleUrl = muhroUrl(item.id);
  const activeRecipe = getEffectiveRecipe(item, item.id);
  header.innerHTML = `
    <span class="item-title">${titleUrl ? `<a href="${titleUrl}" target="_blank" rel="noopener" class="item-link">${escapeHtml(item.name)}</a>` : escapeHtml(item.name)}</span>
    <span class="recipe-subtitle">${(item.craftable && activeRecipe.length > 0) ? 'Craftable' : item.craftable ? 'Craftable (no recipe on file)' : 'Raw material'}</span>
  `;
  panel.appendChild(header);

  if (!item.craftable || activeRecipe.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'no-recipe-msg';
    msg.textContent = item.craftable ? 'No recipe available.' : 'This is a raw material — no recipe.';
    panel.appendChild(msg);
    return;
  }

  // Recipe switcher (when item has multiple recipes)
  if (item.recipes && item.recipes.length > 1) {
    panel.appendChild(buildRecipeSwitcher(item, item.id));
  }

  // Copy button
  const copyBar = document.createElement('div');
  copyBar.className = 'copy-bar';
  copyBar.innerHTML = `<button class="copy-btn" id="copy-btn">copy list</button>`;
  panel.appendChild(copyBar);

  document.getElementById('copy-btn').addEventListener('click', () => {
    const full = buildCopyText(item);
    navigator.clipboard.writeText(full).then(() => {
      const btn = document.getElementById('copy-btn');
      btn.textContent = 'copied!';
      setTimeout(() => { btn.textContent = 'copy list'; }, 1500);
    });
  });

  // Tree
  const treeEl = document.createElement('div');
  treeEl.className = 'ingredient-tree';
  renderIngredientTree(activeRecipe, 1, 1, 0, item.id, treeEl, new Set([item.id]));
  panel.appendChild(treeEl);

  // Legend
  const hasDeductions = hasAnyDeductions(activeRecipe, 1, item.id);
  panel.insertAdjacentHTML('beforeend', `
    <div class="legend">
      <div class="legend-item">
        <span class="legend-dot craftable"></span> Craftable (can be broken down)
      </div>
      <div class="legend-item">
        <span class="legend-dot raw"></span> Raw material
      </div>
      ${hasDeductions ? `
      <div class="legend-item">
        <span class="legend-dot two-col"></span> Two columns: left = recipe total &nbsp;|&nbsp; right = still needed
      </div>` : ''}
    </div>
  `);

  // Shopping List aggregate
  renderAggregateSection(item, panel);
}

/**
 * Renders a flat Shopping List section showing all leaf materials summed
 * across the full recipe tree, respecting skipState and haveState.
 */
/**
 * Sorts aggregate entries: numerics ascending, then alphabetical, Zeny always last.
 */
function sortedAggregateEntries(aggregate) {
  return [...aggregate.entries()].sort(([idA], [idB]) => {
    if (idA === 'zeny') return 1;
    if (idB === 'zeny') return -1;
    const nA = Number(idA), nB = Number(idB);
    if (!isNaN(nA) && !isNaN(nB)) return nA - nB;
    if (!isNaN(nA)) return -1;
    if (!isNaN(nB)) return 1;
    return idA.localeCompare(idB);
  });
}

function renderAggregateSection(item, panel) {
  const aggregate = buildAggregate(getEffectiveRecipe(item, item.id), 1, 1, item.id);
  if (aggregate.size === 0) return;

  const twoCol = [...aggregate.values()].some(e => e.fullTotal !== e.neededTotal);
  const sorted = sortedAggregateEntries(aggregate);

  const section = document.createElement('div');
  section.className = 'aggregate-section';

  let html = `<div class="aggregate-header">Farming List</div><div class="aggregate-list">`;

  for (const [id, entry] of sorted) {
    const deducted = entry.fullTotal !== entry.neededTotal;
    const qtyHtml = twoCol
      ? `<div class="qty-group">
           <span class="qty-badge qty-full${deducted ? ' has-deduction' : ''}">${formatQty(entry.fullTotal)}</span>
           <span class="qty-badge qty-needed${entry.neededTotal === 0 ? ' is-zero' : ''}">${formatQty(entry.neededTotal)}</span>
         </div>`
      : `<span class="qty-badge">${formatQty(entry.fullTotal)}</span>`;

    const aggUrl  = muhroUrl(id);
    const aggName = aggUrl
      ? `<a href="${aggUrl}" target="_blank" rel="noopener" class="item-link">${escapeHtml(entry.name)}</a>`
      : escapeHtml(entry.name);

    html += `<div class="aggregate-row">${qtyHtml}<span class="aggregate-name">${aggName}</span></div>`;
  }

  html += `</div>`;
  section.innerHTML = html;
  panel.appendChild(section);
}

/**
 * Renders a list of recipe ingredients into `containerEl`.
 *
 * Two multipliers flow independently through the tree:
 *   fullMultiplier      — recipe total, unaffected by haveState
 *   effectiveMultiplier — after parent deductions; drives the "needed" column
 *
 * Per row:
 *   fullQty      = ingredient.qty * fullMultiplier      (what the recipe requires)
 *   baseEffQty   = ingredient.qty * effectiveMultiplier (what parent deductions leave)
 *   effectiveQty = max(0, baseEffQty - have)            (after this row's own deduction)
 *
 * Children receive (fullQty, effectiveQty) so both streams propagate correctly.
 */
function renderIngredientTree(ingredients, fullMultiplier, effectiveMultiplier, depth, parentKey, containerEl, ancestors = new Set()) {
  // Two-column layout when any sibling has a have-value OR a parent deduction propagated down
  const twoCol = fullMultiplier !== effectiveMultiplier || ingredients.some((ingredient, index) => {
    const rowKey = `${parentKey}|${ingredient.itemId}|${index}`;
    return (haveState.get(rowKey) || 0) > 0;
  });

  ingredients.forEach((ingredient, index) => {
    const rowKey       = `${parentKey}|${ingredient.itemId}|${index}`;
    const item         = itemsMap.get(ingredient.itemId);
    const fullQty      = ingredient.qty * fullMultiplier;
    const baseEffQty   = ingredient.qty * effectiveMultiplier;
    const have         = haveState.get(rowKey) || 0;
    const effectiveQty = Math.max(0, baseEffQty - have);
    const expanded     = breakdownState.get(rowKey) === true;
    const covered      = effectiveQty === 0 && (have > 0 || effectiveMultiplier === 0);

    if (depth === 0 && index > 0) {
      const divider = document.createElement('hr');
      divider.className = 'ingredient-divider';
      containerEl.appendChild(divider);
    }

    const rowEl = document.createElement('div');
    rowEl.className = 'ingredient-row' + (covered ? ' is-covered' : '');
    rowEl.dataset.depth = depth;

    const isCraftable  = isBreakdownable(item);
    const nameClass    = !item ? 'is-unknown' : isCraftable ? 'is-craftable' : 'is-raw';
    const rawName      = item ? escapeHtml(item.name) : escapeHtml(ingredient.itemId);
    const ingUrl       = muhroUrl(ingredient.itemId);
    const displayName  = ingUrl ? `<a href="${ingUrl}" target="_blank" rel="noopener" class="item-link">${rawName}</a>` : rawName;
    const unknownBadge = !item ? '<span class="unknown-badge">?</span>' : '';
    const connector    = depth === 0 ? '◆' : '└─';

    const skipped          = !willCraft(rowKey, item);
    const wouldLoop        = isCraftable && ancestors.has(ingredient.itemId);
    const leadsToLoop      = isCraftable && !wouldLoop && !!(item?.recipe?.some(ing => ancestors.has(ing.itemId)));
    const blocked          = wouldLoop || leadsToLoop;
    const deducted  = fullQty !== effectiveQty;
    const qtyHtml   = twoCol
      ? `<div class="qty-group">
           <span class="qty-badge qty-full${deducted ? ' has-deduction' : ''}">${formatQty(fullQty)}</span>
           <span class="qty-badge qty-needed${effectiveQty === 0 ? ' is-zero' : ''}">${formatQty(effectiveQty)}</span>
         </div>`
      : `<span class="qty-badge">${formatQty(fullQty)}</span>`;

    rowEl.innerHTML = `
      <div class="ingredient-row-inner">
        <span class="tree-connector">${connector}</span>
        ${qtyHtml}
        <span class="ingredient-name ${nameClass}">${displayName}${unknownBadge}</span>
        ${!blocked && isCraftable && !skipped
          ? `<button class="breakdown-btn ${expanded ? 'expanded' : ''}" data-row-key="${escapeAttr(rowKey)}">
               ${expanded ? '▲ collapse' : '▼ breakdown'}
             </button>`
          : ''}
        ${!blocked && isCraftable
          ? `<label class="craft-toggle" title="Uncheck if obtaining via drop or buy">
               <input type="checkbox" class="craft-check" ${skipped ? '' : 'checked'}>
               craft
             </label>`
          : ''}
        <div class="have-counter" data-row-key="${escapeAttr(rowKey)}">
          <span class="have-label">have:</span>
          <button class="have-btn" data-action="minus" title="Remove one">−</button>
          <span class="have-val" title="Click to type">${have}</span>
          <button class="have-btn" data-action="plus" title="Add one">+</button>
          <button class="have-btn have-all-btn" data-action="all" title="Mark all as owned">✓</button>
        </div>
      </div>
    `;

    // Breakdown toggle
    if (isCraftable && !skipped && !blocked) {
      rowEl.querySelector('.breakdown-btn').addEventListener('click', () => {
        breakdownState.set(rowKey, !breakdownState.get(rowKey));
        renderRecipePanel(selectedItem);
      });
    }

    // Craft checkbox
    if (isCraftable && !blocked) {
      rowEl.querySelector('.craft-check').addEventListener('change', (e) => {
        craftDecisions.set(rowKey, e.target.checked);
        if (!e.target.checked) breakdownState.delete(rowKey); // collapse if was expanded
        renderRecipePanel(selectedItem);
      });
    }

    // Have counter — +/− buttons
    rowEl.querySelector('[data-action="minus"]').addEventListener('click', () => {
      const cur = haveState.get(rowKey) || 0;
      if (cur > 0) haveState.set(rowKey, cur - 1);
      renderRecipePanel(selectedItem);
    });

    rowEl.querySelector('[data-action="plus"]').addEventListener('click', () => {
      const cur = haveState.get(rowKey) || 0;
      haveState.set(rowKey, cur + 1);
      renderRecipePanel(selectedItem);
    });

    rowEl.querySelector('[data-action="all"]').addEventListener('click', () => {
      haveState.set(rowKey, Math.ceil(baseEffQty));
      renderRecipePanel(selectedItem);
    });

    // Have counter — click to type
    rowEl.querySelector('.have-val').addEventListener('click', function () {
      const cur = haveState.get(rowKey) || 0;

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.value = cur;
      input.className = 'have-input';

      this.replaceWith(input);
      input.select();

      function commit() {
        const val = Math.max(0, parseInt(input.value, 10) || 0);
        haveState.set(rowKey, val);
        renderRecipePanel(selectedItem);
      }

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') renderRecipePanel(selectedItem);
      });
      input.addEventListener('blur', commit);
    });

    // Sub-tree — skipped and loop-blocked rows are treated as leaves
    if (isCraftable && expanded && !skipped && !blocked) {
      const subTree = document.createElement('div');
      subTree.className = 'sub-tree';
      const nextAncestors = new Set([...ancestors, ingredient.itemId]);
      if (item.recipes && item.recipes.length > 1) {
        subTree.appendChild(buildRecipeSwitcher(item, rowKey));
      }
      renderIngredientTree(getEffectiveRecipe(item, rowKey), fullQty, effectiveQty, depth + 1, rowKey, subTree, nextAncestors);
      rowEl.appendChild(subTree);
    }

    containerEl.appendChild(rowEl);
  });
}

// ── Text tree builders (for clipboard) ────────────────────────────────────

/**
 * Returns true if any row in this ingredient tree has a have-value > 0.
 */
function hasAnyDeductions(ingredients, multiplier, parentKey) {
  return ingredients.some((ingredient, index) => {
    const rowKey = `${parentKey}|${ingredient.itemId}|${index}`;
    if ((haveState.get(rowKey) || 0) > 0) return true;
    const item = itemsMap.get(ingredient.itemId);
    if (isBreakdownable(item) && breakdownState.get(rowKey) === true && willCraft(rowKey, item)) {
      const qty = ingredient.qty * multiplier;
      return hasAnyDeductions(getEffectiveRecipe(item, rowKey), qty, rowKey);
    }
    return false;
  });
}

/**
 * Full-recipe tree: shows complete quantities regardless of haveState.
 * Annotates rows where the player has some with "(have N)".
 * Children always receive the full qty as multiplier (no deductions propagated).
 */
function buildFullTree(ingredients, multiplier, depth, parentKey, ancestors = new Set()) {
  const indent = '  '.repeat(depth);
  const lines = [];

  ingredients.forEach((ingredient, index) => {
    const rowKey  = `${parentKey}|${ingredient.itemId}|${index}`;
    const item    = itemsMap.get(ingredient.itemId);
    const fullQty = ingredient.qty * multiplier;
    const have    = haveState.get(rowKey) || 0;
    const expanded = breakdownState.get(rowKey) === true;

    const name        = item ? item.name : ingredient.itemId + ' (?)';
    const isCraftable = isBreakdownable(item);
    const recurse     = isCraftable && expanded && willCraft(rowKey, item) && !ancestors.has(ingredient.itemId);
    const craftedNote = recurse ? ' [crafted]' : '';
    const haveNote    = have > 0 ? ` (have ${have})` : '';

    lines.push(`${indent}${formatQtyText(fullQty)} ${name}${craftedNote}${haveNote}`);

    if (recurse) {
      lines.push(buildFullTree(getEffectiveRecipe(item, rowKey), fullQty, depth + 1, rowKey, new Set([...ancestors, ingredient.itemId])));
    }
  });

  return lines.join('\n');
}

/**
 * Needed tree: shows effective quantities after haveState deductions.
 * Rows with effectiveQty === 0 (fully covered) are skipped entirely.
 * Children receive effectiveQty as multiplier so deductions propagate.
 */
function buildNeededTree(ingredients, multiplier, depth, parentKey, ancestors = new Set()) {
  const indent = '  '.repeat(depth);
  const lines = [];

  ingredients.forEach((ingredient, index) => {
    const rowKey       = `${parentKey}|${ingredient.itemId}|${index}`;
    const item         = itemsMap.get(ingredient.itemId);
    const fullQty      = ingredient.qty * multiplier;
    const have         = haveState.get(rowKey) || 0;
    const effectiveQty = Math.max(0, fullQty - have);
    const expanded     = breakdownState.get(rowKey) === true;

    if (effectiveQty === 0) return; // fully covered, skip

    const name        = item ? item.name : ingredient.itemId + ' (?)';
    const isCraftable = isBreakdownable(item);
    const recurse     = isCraftable && expanded && willCraft(rowKey, item) && !ancestors.has(ingredient.itemId);
    const craftedNote = recurse ? ' [crafted]' : '';

    lines.push(`${indent}${formatQtyText(effectiveQty)} ${name}${craftedNote}`);

    if (recurse) {
      lines.push(buildNeededTree(getEffectiveRecipe(item, rowKey), effectiveQty, depth + 1, rowKey, new Set([...ancestors, ingredient.itemId])));
    }
  });

  return lines.filter(Boolean).join('\n');
}

/**
 * Builds a flat aggregate of all leaf materials needed.
 * Always recurses into craftable items (ignores breakdownState),
 * but respects skipState (skipped items are treated as leaves).
 * Returns Map<itemId, { name, category, fullTotal, neededTotal }>
 */
function buildAggregate(ingredients, fullMultiplier, effectiveMultiplier, parentKey) {
  const totals = new Map();

  function recurse(ingr, fullMult, effMult, pKey, ancestors) {
    ingr.forEach((ingredient, index) => {
      const rowKey       = `${pKey}|${ingredient.itemId}|${index}`;
      const item         = itemsMap.get(ingredient.itemId);
      const fullQty      = ingredient.qty * fullMult;
      const baseEffQty   = ingredient.qty * effMult;
      const have         = haveState.get(rowKey) || 0;
      const effectiveQty = Math.max(0, baseEffQty - have);

      if (isBreakdownable(item) && willCraft(rowKey, item) && !ancestors.has(ingredient.itemId)) {
        recurse(getEffectiveRecipe(item, rowKey), fullQty, effectiveQty, rowKey, new Set([...ancestors, ingredient.itemId]));
      } else {
        const name     = item ? item.name : ingredient.itemId + ' (?)';
        const category = item ? (item.category || '') : '';
        if (totals.has(ingredient.itemId)) {
          const entry = totals.get(ingredient.itemId);
          entry.fullTotal   += fullQty;
          entry.neededTotal += effectiveQty;
        } else {
          totals.set(ingredient.itemId, { name, category, fullTotal: fullQty, neededTotal: effectiveQty });
        }
      }
    });
  }

  recurse(ingredients, fullMultiplier, effectiveMultiplier, parentKey, new Set([parentKey]));
  return totals;
}

/**
 * Entry point for copy. Returns one section when nothing is marked,
 * two sections (Recipe + Needed) when any have-deductions are active.
 * Always appends a Shopping List section.
 */
function buildCopyText(item) {
  const recipe = getEffectiveRecipe(item, item.id);
  const hasDeductions = hasAnyDeductions(recipe, 1, item.id);
  const aggregateText = buildAggregateText(item);

  if (!hasDeductions) {
    const recipePart = `${item.name}\n${buildFullTree(recipe, 1, 0, item.id)}`;
    return aggregateText ? `${recipePart}\n\n${aggregateText}` : recipePart;
  }

  const recipePart = `${item.name} - Recipe\n${buildFullTree(recipe, 1, 0, item.id)}`;
  const neededPart = `${item.name} - Needed\n${buildNeededTree(recipe, 1, 0, item.id)}`;
  return aggregateText
    ? `${recipePart}\n\n${neededPart}\n\n${aggregateText}`
    : `${recipePart}\n\n${neededPart}`;
}

/**
 * Builds the plain-text Shopping List section from the aggregate.
 */
function buildAggregateText(item) {
  const aggregate = buildAggregate(getEffectiveRecipe(item, item.id), 1, 1, item.id);
  if (aggregate.size === 0) return '';

  const anyDeductions = [...aggregate.values()].some(e => e.fullTotal !== e.neededTotal);
  const sorted = sortedAggregateEntries(aggregate);
  const lines = [];

  for (const [, entry] of sorted) {
    if (anyDeductions) {
      const neededPart = entry.neededTotal === 0
        ? '(covered)'
        : formatQtyText(entry.neededTotal);
      lines.push(`${formatQtyText(entry.fullTotal)} ${entry.name} -> need: ${neededPart}`);
    } else {
      lines.push(`${formatQtyText(entry.fullTotal)} ${entry.name}`);
    }
  }

  return `${item.name} - Farming List\n${lines.join('\n')}`;
}

function formatQtyText(n) {
  return formatNum(n) + '×';
}

function formatNum(n) {
  const str = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return str.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns true if the item should show a breakdown toggle and be recursed into.
 */
function isBreakdownable(item) {
  if (!item || !item.craftable) return false;
  if (item.recipes && item.recipes.length > 0) return item.recipes.some(r => r.recipe && r.recipe.length > 0);
  return !!(item.recipe && item.recipe.length > 0);
}

/**
 * Returns the active recipe array for an item, respecting recipeChoiceState.
 * Falls back to item.recipe for single-recipe items.
 */
function getEffectiveRecipe(item, key) {
  if (item.recipes && item.recipes.length > 0) {
    const idx = Math.min(recipeChoiceState.get(key) || 0, item.recipes.length - 1);
    return item.recipes[idx]?.recipe || [];
  }
  return item.recipe || [];
}

/**
 * Builds a recipe switcher widget for items with multiple recipes.
 */
function buildRecipeSwitcher(item, key) {
  const current = recipeChoiceState.get(key) || 0;
  const div = document.createElement('div');
  div.className = 'recipe-switcher';
  item.recipes.forEach((r, i) => {
    const btn = document.createElement('button');
    btn.className = 'recipe-tab' + (i === current ? ' active' : '');
    btn.textContent = r.name || `Recipe ${i + 1}`;
    btn.addEventListener('click', () => {
      recipeChoiceState.set(key, i);
      renderRecipePanel(selectedItem);
    });
    div.appendChild(btn);
  });
  return div;
}
function formatQty(n) {
  return formatNum(n);
}

/**
 * Returns true if the player intends to craft this ingredient row.
 * Default: craft (true), unless the item is flagged droppable — then skip (false).
 * The player can always override either direction via the craft checkbox.
 */
function willCraft(rowKey, item) {
  if (craftDecisions.has(rowKey)) return craftDecisions.get(rowKey);
  return !(item && item.droppable);
}

function muhroUrl(itemId) {
  return /^\d+$/.test(itemId)
    ? `https://flux.muhro.eu/?module=item&action=view&id=${itemId}`
    : null;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

// ── Entry ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
