import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Hand-over of the policy between spec files. The PolicyCenter spec saves the number of the policy it issued and the
 * claim creation spec (which runs after it) creates the claim against that policy. The file is git-ignored, it only
 * lives on the machine that ran the PolicyCenter spec.
 */
const FILE = resolve(process.cwd(), 'test-data', 'created-policy.json');

export interface CreatedPolicy {
  policyNumber: string;
  submissionNumber: string;
  effectiveDate: string;
  createdAt: string;
}

export function saveCreatedPolicy(policy: Omit<CreatedPolicy, 'createdAt'>): void {
  writeFileSync(FILE, JSON.stringify({ ...policy, createdAt: new Date().toISOString() }, null, 2));
}

export function loadCreatedPolicy(): CreatedPolicy {
  if (!existsSync(FILE)) {
    throw new Error(
      'No policy to work on: test-data/created-policy.json does not exist. Run the PolicyCenter spec ' +
        '(tests/00-policycenter.spec.ts) first, it saves the number of the policy it issues.',
    );
  }
  const policy = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<CreatedPolicy>;
  if (!policy.policyNumber) throw new Error('test-data/created-policy.json has no policyNumber, run the PolicyCenter spec again.');
  return policy as CreatedPolicy;
}
