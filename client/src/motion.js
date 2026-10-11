export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.075, delayChildren: 0.045 } },
}

export const pageTransition = {
  hidden: { opacity: 0, y: 9 },
  show: { opacity: 1, y: 0, transition: { duration: 0.48, ease: [0.22, 1, 0.36, 1] } },
  initial: { opacity: 0, y: 7 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -3, transition: { duration: 0.16, ease: 'easeIn' } },
}

export const interactiveTransition = { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
