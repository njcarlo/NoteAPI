import { describe, expect, it } from 'vitest';
import { allergens, findAllergyMatches } from './allergy';

describe('allergy matching', () => {
  it('extracts allergens from free text', () => {
    expect(allergens('Penicillin; sulfa drugs (rash), shellfish')).toEqual([
      'penicillin',
      'sulfa',
      'shellfish',
    ]);
    expect(allergens('NKDA')).toEqual([]);
    expect(allergens(null)).toEqual([]);
  });

  it('matches by exact name, including combination drugs', () => {
    expect(findAllergyMatches(['Paracetamol'], 'paracetamol')).toEqual([
      { drug: 'Paracetamol', allergen: 'paracetamol', reason: 'name' },
    ]);
    expect(
      findAllergyMatches(['Phenylephrine + Chlorphenamine + Paracetamol'], 'Paracetamol'),
    ).toHaveLength(1);
  });

  it('matches by drug class', () => {
    expect(findAllergyMatches(['Amoxicillin', 'Co-Amoxiclav'], 'Penicillin')).toEqual([
      { drug: 'Amoxicillin', allergen: 'penicillin', reason: 'class' },
      { drug: 'Co-Amoxiclav', allergen: 'penicillin', reason: 'class' },
    ]);
    expect(findAllergyMatches(['Cotrimoxazole'], 'sulfa drugs')[0]?.reason).toBe('class');
    expect(findAllergyMatches(['Mefenamic Acid'], 'NSAIDs')[0]?.reason).toBe('class');
  });

  it('matches near-spellings', () => {
    expect(findAllergyMatches(['Amoxicillin'], 'amoxicilin')[0]?.reason).toBe('similar');
  });

  it('does not flag unrelated drugs', () => {
    expect(
      findAllergyMatches(['Amlodipine', 'Losartan', 'Metformin'], 'Penicillin, sulfa'),
    ).toEqual([]);
    expect(findAllergyMatches(['Cetirizine'], 'shellfish')).toEqual([]);
  });
});
