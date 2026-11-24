import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Hand-over of the claim between spec files. The claim creation spec saves the number of the claim it created and
 * the payment spec (which runs after it) opens that claim. The file is git-ignored, it only lives on the machine
 * that ran the claim creation spec.
 */
const FILE = resolve(process.cwd(), 'test-data', 'created-claim.json');

export function saveCreatedClaim(claimNumber: string): void {
  writeFileSync(FILE, JSON.stringify({ claimNumber, createdAt: new Date().toISOString() }, null, 2));
}

export function loadCreatedClaim(): string {
  if (!existsSync(FILE)) {
    throw new Error(
      'No claim to work on: test-data/created-claim.json does not exist. Run the claim creation spec ' +
        '(tests/01-new-claim-creation.spec.ts) first, it saves the number of the claim it creates.',
    );
  }
  const { claimNumber } = JSON.parse(readFileSync(FILE, 'utf8')) as { claimNumber?: string };
  if (!claimNumber) throw new Error('test-data/created-claim.json has no claimNumber, run the claim creation spec again.');
  return claimNumber;
}
