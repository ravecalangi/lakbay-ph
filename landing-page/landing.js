const nav = document.getElementById('nav');
const pageName = document.querySelector(".nav-wordmark");
const getStartedBtn = document.querySelector(".nav-right");
const startBtn = document.querySelectorAll(".btn-hero-primary");

startBtn.forEach((btn) => {
  btn.addEventListener("click", () => {
    window.location.href = "../main-page/index.html";
  });
}); 

getStartedBtn.addEventListener("click", () => {
  window.location.href = "../main-page/index.html";
});

pageName.addEventListener("click", () => {
  window.location.href = "landing.html";
});

window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

const heroBg = document.getElementById('hero-bg');
setTimeout(() => heroBg.classList.add('loaded'), 100);

const heroScroll = document.getElementById('hero-scroll');
if (heroScroll) {
  heroScroll.addEventListener('click', () => {
    document.getElementById('intro')?.scrollIntoView({ behavior: 'smooth' });
  });
}

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.10 });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));