/**
 * Ragnarok Craft Breakdown — App Logic
 *
 * Flow:
 *   1. Load data/items.json → build itemsMap (id → item)
 *   2. Search input → filter items → show dropdown
 *   3. User selects item → renderRecipePanel(item)
 *   4. renderRecipePanel builds an ingredient tree via renderIngredientTree()
 *   5. Each craftable ingredient row has a breakdown toggle button
 *   6. Toggle updates breakdownState Map → re-renders the panel
 *
 * Quantity math:
 *   renderIngredientTree(ingredient, multiplier, depth, parentKey)
 *   → displayed qty = ingredient.qty * multiplier
 *   → if broken down: recurse with multiplier = ingredient.qty * multiplier
 *
 * Row identity (breakdownState key):
 *   parentKey + '|' + itemId + '|' + index
 *   Guarantees two rows for the same itemId under different parents
 *   are independent toggles.
 */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let itemsMap = new Map();          // id → item object
let selectedItem = null;           // currently displayed item
const breakdownState = new Map();  // rowKey → boolean (expanded?)

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
    item.name.toLowerCase().includes(query) ||
    (item.category && item.category.toLowerCase().includes(query))
  );

  if (matches.length === 0) {
    listEl.innerHTML = '<li class="no-results">No items found</li>';
  } else {
    for (const item of matches) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="item-name">${escapeHtml(item.name)}</span>
        ${item.category ? `<span class="item-category">${escapeHtml(item.category)}</span>` : ''}
      `;
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
  header.innerHTML = `
    <span class="item-title">${escapeHtml(item.name)}</span>
    ${item.category ? `<span class="item-cat-badge">${escapeHtml(item.category)}</span>` : ''}
    <span class="recipe-subtitle">${(item.craftable && item.recipe && item.recipe.length > 0) ? 'Craftable' : item.craftable ? 'Craftable (no recipe on file)' : 'Raw material'}</span>
  `;
  panel.appendChild(header);

  if (!item.craftable || !item.recipe || item.recipe.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'no-recipe-msg';
    msg.textContent = item.craftable ? 'No recipe available.' : 'This is a raw material — no recipe.';
    panel.appendChild(msg);
    return;
  }

  // Tree
  const treeEl = document.createElement('div');
  treeEl.className = 'ingredient-tree';
  renderIngredientTree(item.recipe, 1, 0, item.id, treeEl);
  panel.appendChild(treeEl);

  // Legend
  panel.insertAdjacentHTML('beforeend', `
    <div class="legend">
      <div class="legend-item">
        <span class="legend-dot craftable"></span> Craftable (can be broken down)
      </div>
      <div class="legend-item">
        <span class="legend-dot raw"></span> Raw material
      </div>
    </div>
  `);
}

/**
 * Renders a list of recipe ingredients into `containerEl`.
 *
 * @param {Array}       ingredients  Array of { itemId, qty }
 * @param {number}      multiplier   Accumulated quantity factor from parent levels
 * @param {number}      depth        Tree depth (0 = top-level)
 * @param {string}      parentKey    Unique key of the parent context (for row identity)
 * @param {HTMLElement} containerEl  Element to append rows into
 */
function renderIngredientTree(ingredients, multiplier, depth, parentKey, containerEl) {
  ingredients.forEach((ingredient, index) => {
    const rowKey   = `${parentKey}|${ingredient.itemId}|${index}`;
    const item     = itemsMap.get(ingredient.itemId);
    const qty      = ingredient.qty * multiplier;
    const expanded = breakdownState.get(rowKey) === true;

    // Add a subtle divider between top-level items (not sub-items)
    if (depth === 0 && index > 0) {
      const divider = document.createElement('hr');
      divider.className = 'ingredient-divider';
      containerEl.appendChild(divider);
    }

    const rowEl = document.createElement('div');
    rowEl.className = 'ingredient-row';
    rowEl.dataset.depth = depth;

    const isCraftable = item && item.craftable && item.recipe && item.recipe.length > 0;
    const nameClass = !item ? 'is-unknown' : isCraftable ? 'is-craftable' : 'is-raw';
    const displayName = item ? escapeHtml(item.name) : escapeHtml(ingredient.itemId);
    const unknownBadge = !item ? '<span class="unknown-badge">?</span>' : '';

    const connector = depth === 0 ? '◆' : '└─';

    rowEl.innerHTML = `
      <div class="ingredient-row-inner">
        <span class="tree-connector">${connector}</span>
        <span class="qty-badge">${formatQty(qty)}</span>
        <span class="ingredient-name ${nameClass}">${displayName}${unknownBadge}</span>
        ${isCraftable
          ? `<button class="breakdown-btn ${expanded ? 'expanded' : ''}" data-row-key="${escapeAttr(rowKey)}">
               ${expanded ? '▲ collapse' : '▼ breakdown'}
             </button>`
          : ''}
      </div>
    `;

    // Wire up toggle button
    if (isCraftable) {
      const btn = rowEl.querySelector('.breakdown-btn');
      btn.addEventListener('click', () => {
        breakdownState.set(rowKey, !breakdownState.get(rowKey));
        renderRecipePanel(selectedItem);
      });
    }

    // If expanded, render sub-tree
    if (isCraftable && expanded) {
      const subTree = document.createElement('div');
      subTree.className = 'sub-tree';
      renderIngredientTree(item.recipe, qty, depth + 1, rowKey, subTree);
      rowEl.appendChild(subTree);
    }

    containerEl.appendChild(rowEl);
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatQty(n) {
  // Show as integer if whole, otherwise 2 decimal places
  return Number.isInteger(n) ? `${n}×` : `${n.toFixed(2)}×`;
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
