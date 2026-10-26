/**
 * Guide routes.
 *
 *   /guide    the hikes assigned to this guide
 *
 * One page, like the permit office. A guide leads people up a mountain; the
 * money and the health records belong to other people, and both the screen and
 * firestore.rules say so.
 *
 * `data` drives the label and icon in the shared staff shell.
 */
import type { Routes } from '@angular/router';
import { guideGuard } from './guide.guard';

export const GUIDE_ROUTES: Routes = [
  {
    path: '',
    canActivate: [guideGuard],
    data: { label: 'Guide', icon: 'map-outline', feed: 'guide' },
    loadComponent: () =>
      import('../staff-shell.component').then((m) => m.StaffShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./guide-hikes.page').then((m) => m.GuideHikesPage),
      },
      { path: '**', redirectTo: '' },
    ],
  },
];
