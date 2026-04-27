function AboutPage() {
  return (
    <section className="about-page split-panel about-split">
      <article className="author-card">
        <p className="eyebrow">About the journal</p>
        <h1 className="archive-title">A personal blog with editorial discipline</h1>
        <p>
          Lin Yue Journal is designed for reflective publishing: fewer distractions, clearer
          archives, and pages that respect long-form reading. The voice leans thoughtful, precise,
          and practical.
        </p>
      </article>

      <article className="principles-card">
        <h3>Brand direction</h3>
        <ul>
          <li>Warm editorial palette instead of generic startup colors</li>
          <li>Calm typography and stronger reading rhythm</li>
          <li>Personal voice without losing structure and usability</li>
          <li>Components that scale from homepage to archive to article pages</li>
        </ul>
      </article>
    </section>
  )
}

export default AboutPage
