/**
 * Downloads the sites CSV bulk-upload template to the user's machine.
 * Includes a header row and two sample rows so admins can see the expected format.
 */
export function downloadSitesTemplate(): void {
  const headers = 'projectCode,siteCode,siteName,city,state,circle,division,address,latitude,longitude';
  const sample1 = 'IOT,SUB-PUNE-047,Pune Substation 47,Pune,Maharashtra,,,,18.5204,73.8567';
  const sample2 = 'IOT,SUB-PUNE-048,Pune Substation 48,Pune,Maharashtra,,,,,';

  const csv  = [headers, sample1, sample2].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);

  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'sites_template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a reference CSV listing all projectCode / taskKey / taskLabel combinations
 * across every project. Admins use this to find the exact taskKey strings needed for
 * the bulk assignment upload.
 */
export function downloadTaskKeysReference(
  projects: Array<{
    projectCode?: string;
    title?:       string;
    projectName?: string;
    taskTemplates?: Array<{
      taskKey: string;
      label:   string;
    }>;
  }>
): void {
  const rows: string[] = ['projectCode,projectName,taskKey,taskLabel'];

  for (const project of projects) {
    const code      = project.projectCode ?? '';
    const name      = project.title ?? project.projectName ?? '';
    const templates = project.taskTemplates ?? [];

    if (templates.length === 0) {
      rows.push(`${code},${name},(no tasks),`);
    } else {
      for (const t of templates) {
        rows.push(`${code},${name},${t.taskKey},${t.label}`);
      }
    }
  }

  const csv  = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);

  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'task_keys_reference.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Downloads the assignments CSV bulk-upload template to the user's machine.
 * Includes a header row and two sample rows so admins can see the expected format.
 */
export function downloadAssignmentTemplate(): void {
  const headers = 'siteCode,taskKey,engineerCode,dueDate';
  const sample1 = 'SUB-PUNE-001,solar_addition,ENG-001,2026-05-01';
  const sample2 = 'SUB-PUNE-002,new_feeder,ENG-002,2026-05-02';

  const csv  = [headers, sample1, sample2].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);

  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'assignments_template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
