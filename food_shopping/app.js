// State tracks active recipe data, selected IDs, and pantry stock numbers
let recipeDatabase = [];
let ingredientCategories = {};
const state = {
  selectedRecipes: new Set(),
  pantryStock: JSON.parse(localStorage.getItem("pantryStock")) || {},
  collapsedCategories:
    JSON.parse(localStorage.getItem("collapsedCategories")) || {},
};

// --- 1. FETCH JSON DATABASE ---
async function loadRecipeDatabase() {
  try {
    // Fetches recipes.json and ingredient categories
    const [recipesResponse, categoriesResponse] = await Promise.all([
      fetch("recipes.json"),
      fetch("ingredient-categories.json"),
    ]);

    if (!recipesResponse.ok) throw new Error("Failed to load recipes.json");
    if (!categoriesResponse.ok)
      throw new Error("Failed to load ingredient-categories.json");

    recipeDatabase = await recipesResponse.json();
    ingredientCategories = await categoriesResponse.json();

    renderRecipes();
    updateShoppingList();
  } catch (error) {
    console.error("Error loading the pseudo-database:", error);
    document.getElementById("recipes-container").innerHTML = `
      <p class="text-rose-600 font-medium">Fejl ved indlæsning af data. Tjek at filerne findes.</p>
    `;
  }
}

// --- 2. RENDER RECIPE CARDS ---
function renderRecipes() {
  const container = document.getElementById("recipes-container");
  if (recipeDatabase.length === 0) {
    container.innerHTML = `<p class="text-gray-500 italic">Ingen opskrifter fundet i recipes.json.</p>`;
    return;
  }

  // Sort: selected recipes first, then alphabetically within each group
  const sortedRecipes = [...recipeDatabase].sort((a, b) => {
    const aSelected = state.selectedRecipes.has(a.id);
    const bSelected = state.selectedRecipes.has(b.id);

    // If selection status differs, selected comes first
    if (aSelected !== bSelected) {
      return bSelected ? 1 : -1;
    }

    // Same selection status, sort alphabetically
    return a.name.localeCompare(b.name);
  });

  container.innerHTML = sortedRecipes
    .map(
      (recipe) => `
      <label class="block bg-white p-4 rounded-xl border-2 transition-all cursor-pointer shadow-sm hover:border-emerald-300 ${state.selectedRecipes.has(recipe.id) ? "border-emerald-500 bg-emerald-50/30" : "border-gray-200"}">
        <div class="flex items-start gap-3">
          <input type="checkbox" class="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" ${state.selectedRecipes.has(recipe.id) ? "checked" : ""} onchange="toggleRecipe('${recipe.id}')">
          <div>
            <span class="font-semibold block text-gray-900">${recipe.name}</span>
            <span class="text-xs text-gray-500 block mt-1">${recipe.ingredients.map((i) => i.name).join(", ")}</span>
          </div>
        </div>
      </label>
    `,
    )
    .join("");
}

function toggleRecipe(recipeId) {
  if (state.selectedRecipes.has(recipeId)) {
    state.selectedRecipes.delete(recipeId);
  } else {
    state.selectedRecipes.add(recipeId);
  }
  renderRecipes();
  updateShoppingList();
}

// --- UNIT CONVERSION HELPERS ---
function normalizeToBaseUnit(amount, unit) {
  // Convert to base units: g for weight, ml for volume
  const conversions = {
    kg: 1000,
    g: 1,
    L: 1000,
    ml: 1,
    spsk: 1,
    tsk: 1,
    stk: 1,
    fed: 1,
  };
  return amount * (conversions[unit] || 1);
}

function getBaseUnit(unit) {
  // Return the base unit for a given unit type
  if (unit === "kg" || unit === "g") return "g";
  if (unit === "L" || unit === "ml") return "ml";
  // if (unit === "L" || unit === "ml" || unit === "spsk" || unit === "tsk")
  // return "ml";
  return unit;
}

function formatAmount(baseAmount, baseUnit) {
  // Convert to best display unit
  if (baseUnit === "g" && baseAmount >= 1000) {
    return { amount: baseAmount / 1000, unit: "kg" };
  }
  if (baseUnit === "ml" && baseAmount >= 1000) {
    return { amount: baseAmount / 1000, unit: "L" };
  }
  return { amount: baseAmount, unit: baseUnit };
}

// --- 3. MATH & SHOPPING LIST GENERATION ---
function updateShoppingList() {
  const container = document.getElementById("shopping-list-container");
  const listActions = document.getElementById("list-actions");

  if (state.selectedRecipes.size === 0) {
    container.innerHTML = `<p class="text-gray-500 italic text-sm">Vælg en ret for at starte din liste.</p>`;
    listActions.style.display = "none";
    return;
  }

  // Show action buttons when there's a list
  listActions.style.display = "flex";

  const totals = {};

  recipeDatabase.forEach((recipe) => {
    if (state.selectedRecipes.has(recipe.id)) {
      recipe.ingredients.forEach((ing) => {
        const key = ing.name.toLowerCase().trim();

        // Skip water completely
        if (key === "vand") return;

        const baseUnit = getBaseUnit(ing.unit);
        const normalizedAmount = normalizeToBaseUnit(ing.amount, ing.unit);

        if (!totals[key]) {
          totals[key] = {
            name: ing.name,
            baseAmount: 0,
            baseUnit: baseUnit,
          };
        }
        totals[key].baseAmount += normalizedAmount;
      });
    }
  });

  // Group ingredients by main category and subcategory
  const itemsByMainCategory = {};
  Object.values(totals).forEach((item) => {
    const key = item.name.toLowerCase().trim();
    const categoryPath = ingredientCategories[key] || "Andet";
    const [mainCategory, subCategory] = categoryPath
      .split(" > ")
      .map((s) => s.trim());

    if (!itemsByMainCategory[mainCategory]) {
      itemsByMainCategory[mainCategory] = {};
    }

    const subCat = subCategory || "Andet";
    if (!itemsByMainCategory[mainCategory][subCat]) {
      itemsByMainCategory[mainCategory][subCat] = [];
    }

    itemsByMainCategory[mainCategory][subCat].push(item);
  });

  // Sort items within each subcategory: incomplete first, then alphabetically
  Object.keys(itemsByMainCategory).forEach((mainCat) => {
    Object.keys(itemsByMainCategory[mainCat]).forEach((subCat) => {
      itemsByMainCategory[mainCat][subCat].sort((a, b) => {
        const keyA = a.name.toLowerCase().trim();
        const keyB = b.name.toLowerCase().trim();
        const stockA = state.pantryStock[keyA] || 0;
        const stockB = state.pantryStock[keyB] || 0;
        const hasEnoughA = Math.max(0, a.baseAmount - stockA) <= 0;
        const hasEnoughB = Math.max(0, b.baseAmount - stockB) <= 0;

        // If completion status differs, incomplete items come first
        if (hasEnoughA !== hasEnoughB) {
          return hasEnoughA ? 1 : -1;
        }

        // If same completion status, sort alphabetically
        return a.name.localeCompare(b.name);
      });
    });
  });

  let html = `<div class="space-y-4">`;

  // Render main categories in alphabetical order
  const mainCategories = Object.keys(itemsByMainCategory).sort();
  mainCategories.forEach((mainCategory) => {
    const subCategories = itemsByMainCategory[mainCategory];

    // Count total items and complete items in main category
    let totalItems = 0;
    let completeItems = 0;
    Object.values(subCategories).forEach((items) => {
      items.forEach((item) => {
        totalItems++;
        const key = item.name.toLowerCase().trim();
        const currentStock = state.pantryStock[key] || 0;
        const finalNeededBase = Math.max(0, item.baseAmount - currentStock);
        if (finalNeededBase <= 0) completeItems++;
      });
    });

    const allComplete = completeItems === totalItems;
    const isMainCollapsed =
      allComplete || state.collapsedCategories[mainCategory];

    html += `
      <div class="main-category-section ${allComplete ? "opacity-75" : ""}">
        <button
          onclick="toggleCategory('${mainCategory}')"
          class="w-full flex items-center justify-between text-base font-extrabold text-gray-800 uppercase tracking-wide py-2.5 px-4 rounded-lg hover:bg-gray-100 transition-colors ${allComplete ? "bg-emerald-100" : "bg-gray-50"}"
          data-category-toggle="${mainCategory}"
        >
          <span class="flex items-center gap-2">
            <svg class="w-5 h-5 transition-transform ${isMainCollapsed ? "" : "rotate-90"}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
            </svg>
            ${mainCategory}
            ${allComplete ? "✓" : ""}
          </span>
          <span class="text-sm font-normal text-gray-600">${completeItems}/${totalItems}</span>
        </button>
        <div class="space-y-3 mt-2 ml-3" style="display: ${isMainCollapsed ? "none" : "block"}" data-category-content="${mainCategory}">`;

    // Render subcategories
    const sortedSubCategories = Object.keys(subCategories).sort();
    sortedSubCategories.forEach((subCategory) => {
      const categoryItems = subCategories[subCategory];
      const categoryKey = `${mainCategory} > ${subCategory}`;

      // Check if all items in subcategory are complete
      const subAllComplete = categoryItems.every((item) => {
        const key = item.name.toLowerCase().trim();
        const currentStock = state.pantryStock[key] || 0;
        const finalNeededBase = Math.max(0, item.baseAmount - currentStock);
        return finalNeededBase <= 0;
      });

      // Auto-collapse if all items complete, or use saved state
      const isSubCollapsed =
        subAllComplete || state.collapsedCategories[categoryKey];
      const itemCount = categoryItems.length;
      const completeCount = categoryItems.filter((item) => {
        const key = item.name.toLowerCase().trim();
        const currentStock = state.pantryStock[key] || 0;
        const finalNeededBase = Math.max(0, item.baseAmount - currentStock);
        return finalNeededBase <= 0;
      }).length;

      html += `
        <div class="subcategory-section ${subAllComplete ? "opacity-75" : ""}">
          <button
            onclick="toggleCategory('${categoryKey}')"
            class="w-full flex items-center justify-between text-sm font-bold text-gray-600 py-2 px-3 rounded-md hover:bg-gray-50 transition-colors ${subAllComplete ? "bg-emerald-50" : ""}"
            data-category-toggle="${categoryKey}"
          >
            <span class="flex items-center gap-2">
              <svg class="w-4 h-4 transition-transform ${isSubCollapsed ? "" : "rotate-90"}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
              </svg>
              ${subCategory}
              ${subAllComplete ? "✓" : ""}
            </span>
            <span class="text-xs font-normal text-gray-500">${completeCount}/${itemCount}</span>
          </button>
          <div class="space-y-4 mt-2 ml-2" style="display: ${isSubCollapsed ? "none" : "block"}" data-category-content="${categoryKey}">`;

      categoryItems.forEach((item) => {
        const key = item.name.toLowerCase().trim();
        const displayTotal = formatAmount(item.baseAmount, item.baseUnit);
        const currentStock = state.pantryStock[key] || 0;
        const finalNeededBase = Math.max(0, item.baseAmount - currentStock);
        const displayNeeded = formatAmount(finalNeededBase, item.baseUnit);
        const hasEnough = finalNeededBase <= 0;
        const isChecked = hasEnough ? "checked" : "";

        html += `
        <div class="border-b border-gray-100 pb-3 last:border-0 ${hasEnough ? "opacity-60" : ""}">
          <div class="flex items-start gap-2 mb-1">
            <input type="checkbox" ${isChecked} class="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer" onchange="toggleIngredient('${key}', ${item.baseAmount})" data-ingredient-checkbox="${key}">
            <div class="flex-1">
              <div class="flex justify-between items-center">
                <span class="font-medium ${hasEnough ? "text-emerald-600 line-through" : "text-gray-800"}">${item.name}</span>
                <span data-buy-key="${key}">${hasEnough ? '<span class="text-emerald-600 font-medium">✓</span>' : `<span class="text-rose-600 font-bold">${displayNeeded.amount} ${displayNeeded.unit}</span>`}</span>
              </div>
              <div class="flex items-center gap-2 mt-2 text-xs">
                <label class="text-gray-500">Jeg har allerede:</label>
                <input type="number" step="0.1" placeholder="0" value="${currentStock || ""}" class="w-16 px-1.5 py-0.5 border border-gray-300 rounded focus:outline-none focus:border-emerald-500" oninput="updateStock('${key}', this.value)" data-base-unit="${item.baseUnit}" data-stock-input="${key}">
                <span class="text-gray-500">${item.baseUnit}</span>
              </div>
            </div>
          </div>
        </div>
      `;
      });

      html += `</div></div>`; // Close subcategory content and section
    });

    html += `</div></div>`; // Close main category content and section
  });

  html += `</div>`; // Close outer container
  container.innerHTML = html;
}

function toggleCategory(category) {
  const content = document.querySelector(
    `[data-category-content="${category}"]`,
  );
  const toggle = document.querySelector(
    `[data-category-toggle="${category}"] svg`,
  );

  if (content.style.display === "none") {
    content.style.display = "block";
    toggle.classList.add("rotate-90");
    state.collapsedCategories[category] = false;
  } else {
    content.style.display = "none";
    toggle.classList.remove("rotate-90");
    state.collapsedCategories[category] = true;
  }

  localStorage.setItem(
    "collapsedCategories",
    JSON.stringify(state.collapsedCategories),
  );
}

function toggleIngredient(key, totalAmount) {
  const checkbox = document.querySelector(
    `[data-ingredient-checkbox="${key}"]`,
  );
  const stockInput = document.querySelector(`[data-stock-input="${key}"]`);

  if (checkbox.checked) {
    // Mark as complete - set stock to total needed
    state.pantryStock[key] = totalAmount;
    if (stockInput) stockInput.value = totalAmount;
  } else {
    // Uncheck - clear the stock
    state.pantryStock[key] = 0;
    if (stockInput) stockInput.value = "";
  }

  localStorage.setItem("pantryStock", JSON.stringify(state.pantryStock));
  updateShoppingList();
}

function updateStock(key, value) {
  const parsed = parseFloat(value) || 0;
  const previousStock = state.pantryStock[key] || 0;
  state.pantryStock[key] = parsed;

  // Persist pantry amounts so they stick around on page refresh
  localStorage.setItem("pantryStock", JSON.stringify(state.pantryStock));

  // Calculate total needed to check if completion status changed
  let totalNeededBase = 0;
  let baseUnit = "";

  recipeDatabase.forEach((recipe) => {
    if (state.selectedRecipes.has(recipe.id)) {
      recipe.ingredients.forEach((ing) => {
        if (ing.name.toLowerCase().trim() === key) {
          baseUnit = getBaseUnit(ing.unit);
          totalNeededBase += normalizeToBaseUnit(ing.amount, ing.unit);
        }
      });
    }
  });

  const wasEnough = Math.max(0, totalNeededBase - previousStock) <= 0;
  const isEnough = Math.max(0, totalNeededBase - parsed) <= 0;

  // Only re-render when completion status changes (to move item up or down)
  if (wasEnough !== isEnough) {
    updateShoppingList();
  }
}

function updateBuyAmount(key) {
  // Calculate the total needed for this ingredient in base units
  let totalNeededBase = 0;
  let baseUnit = "";
  let ingredientName = "";

  recipeDatabase.forEach((recipe) => {
    if (state.selectedRecipes.has(recipe.id)) {
      recipe.ingredients.forEach((ing) => {
        if (ing.name.toLowerCase().trim() === key) {
          baseUnit = getBaseUnit(ing.unit);
          totalNeededBase += normalizeToBaseUnit(ing.amount, ing.unit);
          ingredientName = ing.name;
        }
      });
    }
  });

  const currentStock = state.pantryStock[key] || 0;
  const finalNeededBase = Math.max(0, totalNeededBase - currentStock);
  const displayNeeded = formatAmount(finalNeededBase, baseUnit);
  const hasEnough = finalNeededBase <= 0;

  // Find and update the checkbox
  const checkbox = document.querySelector(
    `[data-ingredient-checkbox="${key}"]`,
  );
  if (checkbox) {
    checkbox.checked = hasEnough;
  }

  // Find the ingredient container
  const buyDisplays = document.querySelectorAll(`[data-buy-key="${key}"]`);
  buyDisplays.forEach((display) => {
    // Update the "Buy:" amount
    display.innerHTML = hasEnough
      ? '<span class="text-emerald-600 font-medium">✓</span>'
      : `<span class="text-rose-600 font-bold">${displayNeeded.amount} ${displayNeeded.unit}</span>`;

    // Find and update the ingredient name and container styling
    const container = display.closest(".border-b");
    const nameSpan = container?.querySelector(".font-medium");

    if (container) {
      if (hasEnough) {
        container.classList.add("opacity-60");
      } else {
        container.classList.remove("opacity-60");
      }
    }

    if (nameSpan) {
      if (hasEnough) {
        nameSpan.className = "font-medium text-emerald-600 line-through";
      } else {
        nameSpan.className = "font-medium text-gray-800";
      }
      nameSpan.textContent = ingredientName;
    }
  });

  // Update category header to reflect completion status
  updateCategoryHeader(key);
}

function updateCategoryHeader(ingredientKey) {
  // Find which category this ingredient belongs to
  const category = ingredientCategories[ingredientKey];
  if (!category) return;

  const categorySection = document.querySelector(
    `[data-category-toggle="${category}"]`,
  );
  if (!categorySection) return;

  // Get all ingredients in this category from the current shopping list
  const totals = {};
  recipeDatabase.forEach((recipe) => {
    if (state.selectedRecipes.has(recipe.id)) {
      recipe.ingredients.forEach((ing) => {
        const key = ing.name.toLowerCase().trim();
        const baseUnit = getBaseUnit(ing.unit);
        const normalizedAmount = normalizeToBaseUnit(ing.amount, ing.unit);
        if (!totals[key]) {
          totals[key] = { name: ing.name, baseAmount: 0, baseUnit: baseUnit };
        }
        totals[key].baseAmount += normalizedAmount;
      });
    }
  });

  // Filter items in this category
  const categoryItems = Object.values(totals).filter((item) => {
    const key = item.name.toLowerCase().trim();
    return ingredientCategories[key] === category;
  });

  if (categoryItems.length === 0) return;

  const completeCount = categoryItems.filter((item) => {
    const key = item.name.toLowerCase().trim();
    const currentStock = state.pantryStock[key] || 0;
    const finalNeededBase = Math.max(0, item.baseAmount - currentStock);
    return finalNeededBase <= 0;
  }).length;

  const allComplete = completeCount === categoryItems.length;

  // Update the header
  const counter = categorySection.querySelector(".text-xs");
  if (counter) {
    counter.textContent = `${completeCount}/${categoryItems.length}`;
  }

  // Update styling
  const categoryContainer = categorySection.closest(".category-section");
  if (categoryContainer) {
    if (allComplete) {
      categoryContainer.classList.add("opacity-75");
      categorySection.classList.add("bg-emerald-50");
      // Auto-collapse completed categories
      const content = document.querySelector(
        `[data-category-content="${category}"]`,
      );
      const toggle = categorySection.querySelector("svg");
      if (content && content.style.display !== "none") {
        content.style.display = "none";
        toggle?.classList.remove("rotate-90");
        state.collapsedCategories[category] = true;
        localStorage.setItem(
          "collapsedCategories",
          JSON.stringify(state.collapsedCategories),
        );
      }
    } else {
      categoryContainer.classList.remove("opacity-75");
      categorySection.classList.remove("bg-emerald-50");
    }
  }

  // Update checkmark
  const categoryTitle = categorySection.querySelector("span:first-child");
  if (categoryTitle) {
    const text = categoryTitle.textContent.replace(" ✓", "");
    categoryTitle.innerHTML = `
      <svg class="w-4 h-4 transition-transform ${state.collapsedCategories[category] ? "" : "rotate-90"}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
      </svg>
      ${text}
      ${allComplete ? "✓" : ""}
    `;
  }
}

// --- 4. COPY SHOPPING LIST ---
function copyShoppingList() {
  const totals = {};

  // Rebuild the shopping list
  recipeDatabase.forEach((recipe) => {
    if (state.selectedRecipes.has(recipe.id)) {
      recipe.ingredients.forEach((ing) => {
        const key = ing.name.toLowerCase().trim();
        const baseUnit = getBaseUnit(ing.unit);
        const normalizedAmount = normalizeToBaseUnit(ing.amount, ing.unit);

        if (!totals[key]) {
          totals[key] = {
            name: ing.name,
            baseAmount: 0,
            baseUnit: baseUnit,
          };
        }
        totals[key].baseAmount += normalizedAmount;
      });
    }
  });

  // Group by category
  const categoryOrder = [
    "Grøntsager",
    "Frugt",
    "Kød & Pålæg",
    "Mejeriprodukter",
    "Frost",
    "Tørvarer",
    "Urter & Krydderier",
    "Olie & Eddike",
    "Drikkevarer",
    "Andet",
  ];

  const itemsByCategory = {};
  Object.values(totals).forEach((item) => {
    const key = item.name.toLowerCase().trim();
    const currentStock = state.pantryStock[key] || 0;
    const finalNeededBase = Math.max(0, item.baseAmount - currentStock);

    if (finalNeededBase > 0) {
      const category = ingredientCategories[key] || "Andet";
      if (!itemsByCategory[category]) {
        itemsByCategory[category] = [];
      }
      const displayNeeded = formatAmount(finalNeededBase, item.baseUnit);
      itemsByCategory[category].push({
        name: item.name,
        amount: displayNeeded.amount,
        unit: displayNeeded.unit,
      });
    }
  });

  // Sort items within each category
  Object.keys(itemsByCategory).forEach((category) => {
    itemsByCategory[category].sort((a, b) => a.name.localeCompare(b.name));
  });

  // Create text version with categories
  let text = "🛍️ Indkøbsliste\n\n";
  categoryOrder.forEach((category) => {
    if (itemsByCategory[category] && itemsByCategory[category].length > 0) {
      text += `── ${category.toUpperCase()} ──\n`;
      itemsByCategory[category].forEach((item) => {
        text += `☐ ${item.name}: ${item.amount} ${item.unit}\n`;
      });
      text += "\n";
    }
  });

  // Copy to clipboard
  navigator.clipboard
    .writeText(text)
    .then(() => {
      showToast("✓ Copied to clipboard!");
    })
    .catch((err) => {
      showToast("Failed to copy", true);
      console.error("Copy failed:", err);
    });
}

// --- 5. CLEAR PANTRY STOCK ---
function clearPantryStock() {
  if (!confirm('Clear all "I already have" amounts?')) return;

  state.pantryStock = {};
  localStorage.setItem("pantryStock", JSON.stringify(state.pantryStock));
  updateShoppingList();
  showToast("✓ Pantry stock cleared");
}

// --- 6. TOAST NOTIFICATIONS ---
function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `no-print fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${isError ? "bg-rose-600" : "bg-gray-800"} text-white`;

  setTimeout(() => {
    toast.classList.add("hidden");
  }, 2500);
}

// Start by pulling data from the JSON file
loadRecipeDatabase();
