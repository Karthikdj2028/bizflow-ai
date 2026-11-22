import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../../src/components/Button';
import { Modal } from '../../src/components/Modal';
import { ConfirmDialog } from '../../src/components/ConfirmDialog';

describe('Button Primitive', () => {
  it('defaults native HTML type to "button"', () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole('button', { name: 'Click me' });
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('preserves caller-supplied native HTML types (submit, reset)', () => {
    const { rerender } = render(<Button type="submit">Submit Form</Button>);
    expect(screen.getByRole('button', { name: 'Submit Form' }).getAttribute('type')).toBe('submit');

    rerender(<Button type="reset">Reset Form</Button>);
    expect(screen.getByRole('button', { name: 'Reset Form' }).getAttribute('type')).toBe('reset');
  });

  it('disables button and displays loader when isLoading is true', () => {
    render(<Button isLoading>Saving</Button>);
    const btn = screen.getByRole('button', { name: 'Saving' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.querySelector('.animate-spin')).toBeDefined();
  });
});

describe('Modal Primitive (Accessibility, Isolation & Focus Trapping)', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  afterEach(() => {
    document.body.style.overflow = '';
    vi.restoreAllMocks();
  });

  const ModalHarness: React.FC<{
    initialOpen?: boolean;
    isLoading?: boolean;
    preventClose?: boolean;
    onCloseMock?: () => void;
  }> = ({ initialOpen = true, isLoading = false, preventClose = false, onCloseMock }) => {
    const [isOpen, setIsOpen] = useState(initialOpen);

    const handleClose = () => {
      onCloseMock?.();
      setIsOpen(false);
    };

    return (
      <div>
        <button id="trigger-btn" onClick={() => setIsOpen(true)}>
          Open Modal
        </button>
        <Modal
          isOpen={isOpen}
          onClose={handleClose}
          title="Test Modal"
          isLoading={isLoading}
          preventClose={preventClose}
        >
          <input id="input-1" placeholder="First Input" />
          <button id="btn-action">Action Button</button>
        </Modal>
      </div>
    );
  };

  it('locks body scroll when open and restores previous overflow on close', () => {
    document.body.style.overflow = 'visible';
    const { unmount } = render(<ModalHarness initialOpen={true} />);

    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('visible');
  });

  it('makes background container inert and aria-hidden while open, without making modal inert', () => {
    const { container } = render(<ModalHarness initialOpen={true} />);

    // Background container where the app was rendered is inert and aria-hidden
    expect(container.hasAttribute('inert')).toBe(true);
    expect(container.getAttribute('aria-hidden')).toBe('true');

    // Modal root portal is NOT inert and NOT aria-hidden
    const modalRoot = document.querySelector('[data-bizflow-modal-root]');
    expect(modalRoot).not.toBeNull();
    expect(modalRoot?.hasAttribute('inert')).toBe(false);
    expect(modalRoot?.getAttribute('aria-hidden')).toBeNull();

    // The dialog inside modal root has proper ARIA attributes
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('restores exact previous inert and aria-hidden states on background elements on close', () => {
    const { container, unmount } = render(<ModalHarness initialOpen={false} />);

    // Custom pre-existing attributes on background container
    container.setAttribute('aria-hidden', 'false');
    container.setAttribute('data-custom', 'test');

    // Open the modal by clicking trigger
    const trigger = screen.getByRole('button', { name: 'Open Modal' });
    fireEvent.click(trigger);

    // While open: background container is inert and aria-hidden='true'
    expect(container.hasAttribute('inert')).toBe(true);
    expect(container.getAttribute('aria-hidden')).toBe('true');

    // Close modal via Escape
    fireEvent.keyDown(document, { key: 'Escape' });

    // On close: exact previous state restored
    expect(container.hasAttribute('inert')).toBe(false);
    expect(container.getAttribute('aria-hidden')).toBe('false');

    unmount();
  });

  it('invokes onClose when Escape is pressed and not loading', () => {
    const onClose = vi.fn();
    render(<ModalHarness initialOpen={true} onCloseMock={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('blocks Escape key and backdrop dismissal when isLoading or preventClose is true', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ModalHarness initialOpen={true} isLoading={true} onCloseMock={onClose} />
    );

    // Escape ignored
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    // Close button disabled
    const closeBtn = screen.getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement;
    expect(closeBtn.disabled).toBe(true);
    fireEvent.click(closeBtn);
    expect(onClose).not.toHaveBeenCalled();

    // Backdrop click ignored
    const backdrop = document.querySelector('.backdrop-blur-sm');
    expect(backdrop).toBeDefined();
    if (backdrop) {
      fireEvent.click(backdrop);
    }
    expect(onClose).not.toHaveBeenCalled();

    // Test preventClose=true
    rerender(
      <ModalHarness initialOpen={true} isLoading={false} preventClose={true} onCloseMock={onClose} />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('restores focus to trigger button when modal closes', async () => {
    const user = userEvent.setup();
    render(<ModalHarness initialOpen={false} />);

    const trigger = screen.getByRole('button', { name: 'Open Modal' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Click trigger to open modal
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeDefined();

    // Close modal via Escape
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('handles Tab and Shift+Tab correctly when the dialog container itself has focus', () => {
    render(<ModalHarness initialOpen={true} />);

    const dialog = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
    const actionBtn = screen.getByRole('button', { name: 'Action Button' });

    // Explicitly focus dialog container
    dialog.focus();
    expect(document.activeElement).toBe(dialog);

    // Tab from dialog container -> moves to first focusable element (close button)
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab when dialog container is focused -> moves to last focusable element (actionBtn)
    dialog.focus();
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(actionBtn);
  });

  it('redirects focus immediately when focus escapes to an external element', () => {
    render(<ModalHarness initialOpen={true} />);

    const closeBtn = screen.getByRole('button', { name: 'Close dialog' });

    // Create an external element in body
    const externalBtn = document.createElement('button');
    externalBtn.textContent = 'External Element';
    document.body.appendChild(externalBtn);

    // Trigger focusin on external element
    fireEvent.focusIn(externalBtn);

    // Focus redirected back to modal's first focusable element
    expect(document.activeElement).toBe(closeBtn);

    externalBtn.remove();
  });

  it('handles a genuine zero-focusable-element dialog safely', () => {
    const { unmount } = render(
      <Modal isOpen={true} onClose={() => {}} title="Zero Focusable" isLoading={true} preventClose={true}>
        <p>Pure read-only informational message without any buttons or links.</p>
      </Modal>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();

    // Tab and Shift+Tab do not throw and remain trapped on dialog container
    expect(() => {
      fireEvent.keyDown(document, { key: 'Tab' });
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    }).not.toThrow();

    unmount();
  });

  it('strictly excludes controls hidden by ancestor elements, disabled controls, inert subtrees, and aria-hidden subtrees', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Filtering Test" isLoading={true} preventClose={true}>
        {/* Valid interactive controls */}
        <button id="btn-valid-1">Valid 1</button>
        <button id="btn-valid-2">Valid 2</button>

        {/* Hidden ancestor via display:none */}
        <div style={{ display: 'none' }}>
          <button id="btn-hidden-style">Hidden By Style</button>
        </div>

        {/* Hidden ancestor via hidden attribute */}
        <div hidden>
          <button id="btn-hidden-attr">Hidden By Attr</button>
        </div>

        {/* Aria-hidden ancestor */}
        <div aria-hidden="true">
          <button id="btn-aria-hidden-ancestor">Aria Hidden Ancestor</button>
        </div>

        {/* Disabled fieldset ancestor */}
        <fieldset disabled>
          <button id="btn-fieldset-disabled">Fieldset Disabled</button>
        </fieldset>

        {/* Direct disabled button */}
        <button id="btn-disabled" disabled>
          Direct Disabled
        </button>
      </Modal>
    );

    const dialog = screen.getByRole('dialog');

    // Create inert ancestor container through DOM to avoid JSX typing limitations
    const inertContainer = document.createElement('div');
    inertContainer.setAttribute('inert', '');
    const inertBtn = document.createElement('button');
    inertBtn.id = 'btn-inert-ancestor';
    inertBtn.textContent = 'Inert Ancestor';
    inertContainer.appendChild(inertBtn);
    dialog.appendChild(inertContainer);

    const valid1 = screen.getByRole('button', { name: 'Valid 1' });
    const valid2 = screen.getByRole('button', { name: 'Valid 2' });

    // Focus last valid control -> Tab wraps to first valid control (skipping all invalid elements)
    valid2.focus();
    expect(document.activeElement).toBe(valid2);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(valid1);

    // Focus first valid control -> Shift+Tab wraps to last valid control (skipping all invalid elements)
    valid1.focus();
    expect(document.activeElement).toBe(valid1);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(valid2);

    // Clean up inert test element
    inertContainer.remove();
  });

  it('safely handles multiple stacked modals with shadowing and LIFO restoration', () => {
    const StackedHarness = () => {
      const [openModal1, setOpenModal1] = useState(true);
      const [openModal2, setOpenModal2] = useState(false);

      return (
        <div>
          <Modal isOpen={openModal1} onClose={() => setOpenModal1(false)} title="Modal 1">
            <button id="open-modal-2-btn" onClick={() => setOpenModal2(true)}>
              Open Second Modal
            </button>
          </Modal>

          <Modal isOpen={openModal2} onClose={() => setOpenModal2(false)} title="Modal 2">
            <button id="modal-2-action">Modal 2 Action</button>
          </Modal>
        </div>
      );
    };

    const { container } = render(<StackedHarness />);

    const modalRoots = () => document.querySelectorAll('[data-bizflow-modal-root]');
    expect(modalRoots().length).toBe(1);

    const modal1Root = modalRoots()[0];
    expect(modal1Root.hasAttribute('inert')).toBe(false);
    expect(container.hasAttribute('inert')).toBe(true);

    // Open second modal
    const openModal2Btn = screen.getByRole('button', { name: 'Open Second Modal' });
    fireEvent.click(openModal2Btn);

    expect(modalRoots().length).toBe(2);
    const modal2Root = modalRoots()[1];

    // Modal 1 is now shadowed (inert)
    expect(modal1Root.hasAttribute('inert')).toBe(true);
    expect(modal1Root.getAttribute('aria-hidden')).toBe('true');

    // Modal 2 is active
    expect(modal2Root.hasAttribute('inert')).toBe(false);

    // Close second modal via Escape
    fireEvent.keyDown(document, { key: 'Escape' });

    // Modal 1 is restored to active
    expect(modalRoots().length).toBe(1);
    expect(modal1Root.hasAttribute('inert')).toBe(false);
    expect(modal1Root.getAttribute('aria-hidden')).toBeNull();

    // Close first modal via Escape
    fireEvent.keyDown(document, { key: 'Escape' });

    // Background container is restored
    expect(modalRoots().length).toBe(0);
    expect(container.hasAttribute('inert')).toBe(false);
    expect(container.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('ConfirmDialog Primitive', () => {
  it('connects isLoading to preventClose and disables cancel button', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <ConfirmDialog
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete Item"
        message="Are you sure you want to delete this?"
        isLoading={true}
      />
    );

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
    const confirmBtn = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;

    expect(cancelBtn.disabled).toBe(true);
    expect(confirmBtn.disabled).toBe(true);

    // Escape blocked
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
