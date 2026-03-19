// Scroll-triggered fade-up animations
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        // stagger siblings in same parent
        const siblings = [...entry.target.parentElement.querySelectorAll('.animate-scroll')];
        const idx = siblings.indexOf(entry.target);
        setTimeout(() => {
          entry.target.classList.add('visible');
        }, idx * 80);
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll('.animate-scroll').forEach((el) => observer.observe(el));
