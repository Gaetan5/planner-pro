import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto } from '../../../src/projects/dto/create-project.dto';
import { UpdateProjectDto } from '../../../src/projects/dto/update-project.dto';
import { UpdateProjectFinancesDto } from '../../../src/projects/dto/update-project-finances.dto';

/**
 * N4 : `billingType` est une valeur fermée aux trois endroits (création, mise à jour, finances),
 * et non plus un texte libre borné différemment selon la route (50, 50 et 191).
 */
describe('N4 : billingType, valeur fermée', () => {
  const cases = [
    ['CreateProjectDto', CreateProjectDto, { name: 'Projet' }],
    ['UpdateProjectDto', UpdateProjectDto, {}],
    ['UpdateProjectFinancesDto', UpdateProjectFinancesDto, {}],
  ] as const;

  it.each(cases)(
    '%s : accepte TIME_AND_MATERIALS, FIXED_PRICE et l’absence de valeur',
    async (_n, cls, base) => {
      for (const billingType of ['TIME_AND_MATERIALS', 'FIXED_PRICE', undefined]) {
        const errors = await validate(plainToInstance(cls, { ...base, billingType }));
        expect(errors).toEqual([]);
      }
    },
  );

  it.each(cases)(
    '%s : refuse toute autre valeur (texte libre, casse, long, non textuel)',
    async (_n, cls, base) => {
      for (const billingType of [
        'HOURLY',
        'fixed_price',
        'x'.repeat(300_000),
        '',
        7,
        ['FIXED_PRICE'],
      ]) {
        const errors = await validate(plainToInstance(cls, { ...base, billingType }));
        expect(errors.map((e) => e.property)).toContain('billingType');
      }
    },
  );
});
