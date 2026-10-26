/**
 * Reusable trail card: presents a trail summary and emits selection actions so parent pages can open the matching trail.
 */
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonButton } from '@ionic/angular/standalone';
import { Trail } from '../../models/trail.model';
import { WishlistService } from '../../services/wishlist.service';

@Component({
  selector: 'app-trail-card',
  standalone: true,
  templateUrl: './trail-card.component.html',
  styleUrls: ['./trail-card.component.scss'],
  imports: [CommonModule, IonIcon, IonButton],
})
export class TrailCardComponent {
  @Input({ required: true }) trail!: Trail;
  @Output() details = new EventEmitter<Trail>();
  @Output() cardTap = new EventEmitter<Trail>();

  /** The heart in the corner — the same Wishlist as the trail page and Explore. */
  readonly wishlist = inject(WishlistService);

  /** Hearts or un-hearts this trail without opening it. */
  onHeart(ev: Event) {
    ev.stopPropagation();
    void this.wishlist.toggle(this.trail);
  }

  /** Emits the details action so the parent page can open this trail. */
  onDetails(ev: Event) {
    ev.stopPropagation();
    this.details.emit(this.trail);
  }

  /** Emits the card tap so the parent page can navigate to the trail. */
  onTap() {
    this.cardTap.emit(this.trail);
  }
}
