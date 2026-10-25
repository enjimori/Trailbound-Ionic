/**
 * Permit office routes.
 *
 *   /office    the application queue — issue or refuse
 *
 * One page, on purpose. An officer decides permits; everything else about a
 * booking belongs to TrailBound. If a second screen ever appears here, ask
 * first whether the office actually needs it, or whether it is TrailBound's
 * work leaking across the line.
 *
 * Sits beside /admin rather than under it, because adminGuard protects the
 * whole admin shell. Hanging the office off that shell would mean loosening
 * one guard for nine admin pages so that one non-admin account could reach a
 * tenth — a bad trade, and the sort that quietly becomes a hole later.
 *
 * `data` drives the label and icon in the shared staff shell, which guides use
 * too.
 */
import type { Routes } from '@angular/router';
import { officeGuard } from './office.guard';

export const OFFICE_ROUTES: Routes = [
  {
    path: '',
    canActivate: [officeGuard],
    data: { label: 'Permit office', icon: 'ribbon-outline' },
    loadComponent: () =>
      import('../staff-shell.component').then((m) => m.StaffShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./office-queue.page').then((m) => m.OfficeQueuePage),
      },
      { path: '**', redirectTo: '' },
    ],
  },
];