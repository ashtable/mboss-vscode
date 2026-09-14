import { NodeIcon } from '../canvas/icons.js';
import { postToHost } from '../webview/client.js';
import { mountView } from '../webview/mount.js';
import { Button } from '../webview/signal/Button.js';
import { StateWord } from '../webview/signal/StateWord.js';
import type {
  GalleryCard,
  GalleryInit,
  GalleryShelf,
  GalleryStrings,
} from '../webview/protocol.js';

import './gallery.css';

/**
 * A shelf of workflows to start from.
 *
 * The argument this page makes is that a pattern is
 * not a wizard or a scaffold: it is the same
 * document the canvas draws, already drawn. So each
 * card leads with the blocks the workflow is made
 * of, in the order it uses them, set in the same
 * tiles the canvas sets them in — and says nothing
 * about frameworks, stacks or steps saved.
 *
 * One card wears the ring. Which one is a fact
 * about the library rather than a preference, and a
 * gallery where every card is emphasised emphasises
 * nothing.
 */

function Gallery({ strings, groups }: GalleryInit) {
  return (
    <div className="gallery" data-gallery>
      <p className="title">{strings.heading}</p>
      <p className="gallery-note gallery-hint">{strings.hint}</p>

      {/* The way in that is not a pattern at all,
          kept at the top and drawn in dashes: the
          dashes mean nothing has been decided
          here yet. */}
      <section className="blank">
        <div className="blank-text">
          <p className="blank-title">{strings.blank.title}</p>
          <p className="gallery-note">{strings.blank.body}</p>
        </div>

        {/* The outline, so the one action on the
            dashed card still reads apart from the
            quiet Use on every card below it. */}
        <Button
          variant="secondary"
          ink="brand"
          hook={{ 'start-blank': '' }}
          onClick={() => postToHost({ type: 'startBlank' })}
        >
          {strings.blank.action}
        </Button>
      </section>

      {groups.map((shelf) => (
        <Shelf key={shelf.group} shelf={shelf} strings={strings} />
      ))}

      <p className="more">{strings.more}</p>
    </div>
  );
}

function Shelf({
  shelf,
  strings,
}: {
  shelf: GalleryShelf;
  strings: GalleryStrings;
}) {
  return (
    <section className="shelf" data-group={shelf.group}>
      <p className="section-label">{strings.groups[shelf.group]}</p>

      <ul className="template-grid">
        {shelf.cards.map((card) => (
          <li key={card.name}>
            <Card card={card} strings={strings} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One pattern.
 *
 * The glyph run is the card's whole picture of the
 * workflow: four tiles joined by hairlines, which
 * is what a wire is drawn as everywhere else. It is
 * deliberately not a thumbnail of the graph — a
 * graph shrunk to card width is a smudge, and these
 * four say the same thing in a line a person can
 * read at a glance.
 */
function Card({
  card,
  strings,
}: {
  card: GalleryCard;
  strings: GalleryStrings;
}) {
  return (
    <article
      className="card template-card"
      data-pattern={card.name}
      data-flagship={String(card.demo)}
    >
      <header className="template-head">
        <ol className="template-glyphs">
          {card.glyphs.map((kind, index) => (
            <li key={`${kind}-${index}`} data-glyph={kind}>
              <NodeIcon kind={kind} tone="neutral" size="md" />
            </li>
          ))}
        </ol>

        {card.demo ? (
          <StateWord tone="brand" hook={{ demo: '' }}>
            {strings.demo}
          </StateWord>
        ) : null}
      </header>

      <p className="template-title">{card.title}</p>
      <p className="gallery-note template-summary">{card.summary}</p>

      <ul className="template-tags">
        {card.tags.map((tag) => (
          <li key={tag} className="template-tag">
            {tag}
          </li>
        ))}
      </ul>

      {/* Quiet, because a shelf where forty cards
          each shout Use is a shelf with nothing to
          read first. */}
      <Button
        variant="quiet"
        ink="brand"
        hook={{ use: '' }}
        hookClass="template-use"
        onClick={() => postToHost({ type: 'usePattern', name: card.name })}
      >
        {strings.use}
      </Button>
    </article>
  );
}

mountView('gallery', Gallery);
