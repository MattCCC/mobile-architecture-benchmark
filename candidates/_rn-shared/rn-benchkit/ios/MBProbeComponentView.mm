#import "MBProbeComponentView.h"
#import "MBBenchKitCore.h"

#import <react/renderer/components/MobileBenchKitSpec/ComponentDescriptors.h>
#import <react/renderer/components/MobileBenchKitSpec/Props.h>
#import <react/renderer/components/MobileBenchKitSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

/// Opaque white 1 x 1 pt view: `drawRect:` reports the current token to the core; a token change calls
/// `setNeedsDisplay` so the next display pass draws it (UIKit otherwise keeps the layer contents).
@interface MBProbeDrawView : UIView
@property (nonatomic, copy) NSString *kind;
@property (nonatomic, assign) NSInteger index;
@property (nonatomic, copy) NSString *token;
@end

@implementation MBProbeDrawView

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    self.opaque = YES;
    self.backgroundColor = UIColor.whiteColor;
    self.contentMode = UIViewContentModeRedraw;
    _kind = @"";
    _token = @"";
  }
  return self;
}

- (void)drawRect:(CGRect)rect
{
  [UIColor.whiteColor setFill];
  UIRectFill(rect);
  [[MBBenchKitCore shared] probeDrawn:_kind index:_index token:_token];
}

@end

@implementation MBProbeComponentView {
  MBProbeDrawView *_view;
  double _height;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<MobileBenchProbeComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const MobileBenchProbeProps>();
    _props = defaultProps;
    _view = [[MBProbeDrawView alloc] initWithFrame:CGRectZero];
    _height = -1;
    self.contentView = _view;
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newProps = *std::static_pointer_cast<MobileBenchProbeProps const>(props);
  NSString *kind = [NSString stringWithUTF8String:newProps.kind.c_str()];
  NSString *token = [NSString stringWithUTF8String:newProps.token.c_str()];
  _view.kind = kind;
  _view.index = newProps.index;
  // Kind `list` never draws (no backing store for a container-sized view); it reports its height only.
  _view.hidden = [kind isEqualToString:@"list"];
  if (![_view.token isEqualToString:token]) {
    _view.token = token;
    [_view setNeedsDisplay];
  }
  [super updateProps:props oldProps:oldProps];
  [self reportListHeight];
}

- (void)updateLayoutMetrics:(LayoutMetrics const &)layoutMetrics oldLayoutMetrics:(LayoutMetrics const &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  _height = layoutMetrics.frame.size.height;
  [self reportListHeight];
}

- (void)reportListHeight
{
  if ([_view.kind isEqualToString:@"list"] && _height > 0) {
    [[MBBenchKitCore shared] listLayout:_height];
  }
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _view.token = @"";
  _view.kind = @"";
  _height = -1;
}

@end

Class<RCTComponentViewProtocol> MobileBenchProbeCls(void)
{
  return MBProbeComponentView.class;
}
