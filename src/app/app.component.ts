/**
 * Application shell: hosts the Ionic app and router outlet where the active route page is rendered.
 */
import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { ThemeService } from './services/theme.service';
import { ChatFabComponent } from './components/chat-bot/chat-fab.component';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <ion-app>
      <ion-router-outlet></ion-router-outlet>
      <app-chat-fab />
    </ion-app>
  `,
  imports: [IonApp, IonRouterOutlet, ChatFabComponent],
})
export class AppComponent {
  constructor(_themeService: ThemeService) {}
}
