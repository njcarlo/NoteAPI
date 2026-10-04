/**
 * Non-blocking allergy check: does a drug's generic name plausibly conflict with the patient's
 * free-text allergies? Matches by name, by drug class (e.g. "penicillin" → amoxicillin) and by
 * near-spelling ("amoxicilin"). The doctor must acknowledge a warning, never be stopped by it.
 */

const DRUG_CLASSES: Record<string, string[]> = {
  penicillin: [
    'amoxicillin',
    'co-amoxiclav',
    'ampicillin',
    'cloxacillin',
    'penicillin',
    'piperacillin',
  ],
  cephalosporin: [
    'cefalexin',
    'cephalexin',
    'cefuroxime',
    'cefixime',
    'ceftriaxone',
    'cefaclor',
    'cefadroxil',
  ],
  sulfa: ['cotrimoxazole', 'sulfamethoxazole', 'sulfasalazine'],
  sulfonamide: ['cotrimoxazole', 'sulfamethoxazole', 'sulfasalazine'],
  macrolide: ['azithromycin', 'clarithromycin', 'erythromycin'],
  quinolone: ['ciprofloxacin', 'levofloxacin', 'ofloxacin', 'moxifloxacin'],
  fluoroquinolone: ['ciprofloxacin', 'levofloxacin', 'ofloxacin', 'moxifloxacin'],
  tetracycline: ['doxycycline', 'tetracycline', 'minocycline'],
  nsaid: [
    'ibuprofen',
    'mefenamic acid',
    'naproxen',
    'naproxen sodium',
    'celecoxib',
    'diclofenac',
    'aspirin',
    'ketorolac',
  ],
  aspirin: [
    'aspirin',
    'ibuprofen',
    'mefenamic acid',
    'naproxen',
    'naproxen sodium',
    'diclofenac',
    'ketorolac',
  ],
  statin: ['atorvastatin', 'rosuvastatin', 'simvastatin'],
  'ace inhibitor': ['captopril', 'enalapril', 'lisinopril'],
};

const STOP_WORDS = new Set([
  'allergy',
  'allergic',
  'to',
  'and',
  'or',
  'drug',
  'drugs',
  'medicine',
  'meds',
  'none',
  'known',
  'no',
  'nkda',
  'rash',
  'hives',
  'reaction',
  'with',
  'the',
  'of',
  'a',
]);

export interface AllergyMatch {
  drug: string;
  allergen: string;
  reason: 'name' | 'class' | 'similar';
}

const normalize = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** "Phenylephrine + Chlorphenamine + Paracetamol" → each ingredient. */
export const ingredients = (genericName: string) =>
  normalize(genericName)
    .split(/\s*(?:\+|\/|,| and )\s*/)
    .filter(Boolean);

/** Allergy phrases from free text, e.g. "Penicillin; sulfa drugs (rash)" → ["penicillin", "sulfa"]. */
export function allergens(allergyText: string | null | undefined): string[] {
  if (!allergyText) return [];
  const phrases = normalize(allergyText)
    .replace(/\(.*?\)/g, ' ')
    .split(/[,;/\n]|\band\b/)
    .map((p) =>
      p
        .split(/\s+/)
        .filter((w) => w && !STOP_WORDS.has(w))
        .join(' '),
    )
    .filter((p) => p.length >= 3);
  return [...new Set(phrases)];
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length]!;
}

function matchOne(ingredient: string, allergen: string): AllergyMatch['reason'] | null {
  if (ingredient.includes(allergen) || allergen.includes(ingredient)) return 'name';
  for (const [className, members] of Object.entries(DRUG_CLASSES)) {
    if (
      (allergen === className ||
        allergen.startsWith(`${className} `) ||
        allergen.startsWith(className)) &&
      members.includes(ingredient)
    ) {
      return 'class';
    }
  }
  const words = allergen.split(' ');
  if (words.some((w) => w.length >= 5 && levenshtein(w, ingredient) <= 2)) return 'similar';
  return null;
}

/** Every (drug, allergen) pair that looks like a conflict. */
export function findAllergyMatches(
  genericNames: string[],
  allergyText: string | null | undefined,
): AllergyMatch[] {
  const list = allergens(allergyText);
  const matches: AllergyMatch[] = [];
  for (const drug of genericNames) {
    for (const ingredient of ingredients(drug)) {
      for (const allergen of list) {
        const reason = matchOne(ingredient, allergen);
        if (reason) {
          matches.push({ drug, allergen, reason });
          break;
        }
      }
    }
  }
  return matches.filter(
    (m, i) => matches.findIndex((o) => o.drug === m.drug && o.allergen === m.allergen) === i,
  );
}
