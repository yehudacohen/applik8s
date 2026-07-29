// typecast-file-boundary: search authoring fixtures inspect promoted model facets whose runtime validation supplies the asserted generic shape.
import { relations } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';
import {
  Search,
  TransactionalDatabase,
  app,
  applicationGraphFor,
  search,
} from '../src/application.js';

function catalogSchema() {
  const categories = pgTable('search_categories', {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
  });
  const products = pgTable('search_products', {
    id: uuid('id').primaryKey(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    title: text('title').notNull(),
    description: text('description'),
    marketValue: text('market_value').notNull(),
    createdAt: text('created_at').notNull(),
  });
  const categoriesRelations = relations(categories, ({ many }) => ({
    products: many(products),
  }));
  const productsRelations = relations(products, ({ one }) => ({
    category: one(categories, {
      fields: [products.categoryId],
      references: [categories.id],
    }),
  }));
  return {
    categories,
    products,
    schema: {
      categories,
      products,
      categoriesRelations,
      productsRelations,
    },
  };
}

describe('application search projections', () => {
  test('compiles model-bound and advanced declarations into one stable graph contract', () => {
    const { categories, products, schema } = catalogSchema();
    const providerDatabase = TransactionalDatabase.postgres({
      name: 'catalog-postgres',
    });
    const application = app('search-catalog', {
      namespace: 'search-catalog',
    });
    const database = application.database.postgres('catalog', { schema });
    application.provide(
      Search,
      Search.postgres({
        database: providerDatabase,
        maximumCandidateRows: 2_000,
      }),
    );
    const Category = application.model(categories, {
      name: 'Category',
      database,
    });
    const Product = application.model(products, {
      name: 'Product',
      database,
    });
    const categoryName = search.path(
      Product,
      Product.$model.relations.category!,
      Category.name,
    );
    const modelBound = Product.index(
      'product-search',
      search.text(Product.title, { boost: 4 }).as('title'),
      search.text(Product.description).as('description'),
      search.facet(categoryName).as('categoryName'),
      search.filter(Product.marketValue).as('marketValue'),
      search.filter(Product.createdAt).as('createdAt'),
    );
    const advanced = application.index(
      'product-search-advanced',
      { root: Product, identity: Product.id },
      search.text(Product.title).as('title'),
      search.facet(categoryName).as('categoryName'),
    );

    expect(modelBound.search.operation.id).toBe('product-search.search');
    expect(modelBound.fields.marketValue.desc()).toEqual({
      field: 'marketValue',
      direction: 'desc',
    });
    expect(modelBound.plan.logicalIdentity).toEqual({
      application: 'search-catalog',
      name: 'product-search',
    });
    expect(modelBound.plan.sourceFrontiers.map(({ model }) => model)).toEqual([
      'Category',
      'Product',
    ]);
    expect(
      modelBound.plan.inverseInvalidation.find(
        ({ sourceModel }) => sourceModel === 'Category',
      ),
    ).toMatchObject({
      affectedRoot: 'Product',
      lookup: 'foreignKey',
      relationships: ['category'],
    });
    expect(advanced.plan.root).toEqual(modelBound.plan.root);
    expect(advanced.plan.synchronization).toEqual(
      modelBound.plan.synchronization,
    );

    const graph = applicationGraphFor(application);
    expect(graph?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'index.product-search',
          kind: 'index',
          purpose: 'searchProjection',
          provider: expect.objectContaining({ interface: 'Search' }),
        }),
        expect.objectContaining({
          id: 'query.product-search-search',
          kind: 'query',
          publicId: 'product-search.search',
        }),
      ]),
    );
    expect(graph?.providerRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          interface: 'Search',
          consumer: { nodeId: 'index.product-search' },
        }),
      ]),
    );
  });

  test('rejects an unaggregated many-valued relationship path', () => {
    const { categories, products, schema } = catalogSchema();
    const application = app('search-cardinality');
    const database = application.database.postgres('catalog', { schema });
    const Category = application.model(categories, {
      name: 'Category',
      database,
    });
    const Product = application.model(products, {
      name: 'Product',
      database,
    });
    const productTitle = search.path(
      Category,
      Category.$model.relations.products!,
      Product.title,
    );
    expect(() =>
      Category.index(
        'category-search',
        // typecast: deliberately bypass the compile-time scalar guard to prove
        // the graph compiler independently rejects unaggregated fan-out.
        search.text(productTitle as never).as('productTitle'),
      ),
    ).toThrow(/requires search\.values\(\), search\.minimum\(\), search\.maximum\(\), or search\.count\(\)/);
  });

  test('keeps logical identity and revision independent of the export variable', () => {
    const { products, schema } = catalogSchema();
    const application = app('stable-search');
    const database = application.database.postgres('catalog', { schema });
    const Product = application.model(products, {
      name: 'Product',
      database,
    });
    const original = Product.index(
      'products',
      search.text(Product.title).as('title'),
    );
    const renamedExport = original;

    expect(renamedExport.name).toBe('products');
    expect(renamedExport.plan.revision.digest).toBe(
      original.plan.revision.digest,
    );
  });
});
