#import "MBIslandProbeComponentView.h"
#import "MBIslandBench.h"

#import <react/renderer/components/MobileBenchIslandBenchSpec/ComponentDescriptors.h>
#import <react/renderer/components/MobileBenchIslandBenchSpec/Props.h>
#import <react/renderer/components/MobileBenchIslandBenchSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

/// Opaque white 1 x 1 pt view: `drawRect:` reports the current token to the host's marker core; a token change calls
/// `setNeedsDisplay` so the next display pass draws it (UIKit otherwise keeps the layer contents).
@interface MBIslandProbeDrawView : UIView
@property (nonatomic, copy) NSString *kind;
@property (nonatomic, assign) NSInteger index;
@property (nonatomic, copy) NSString *token;
@end

@implementation MBIslandProbeDrawView

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
  [MBIslandHostBench() probeDrawn:_kind index:_index token:_token];
}

@end

@implementation MBIslandProbeComponentView {
  MBIslandProbeDrawView *_view;
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
    _view = [[MBIslandProbeDrawView alloc] initWithFrame:CGRectZero];
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
  // Kind `list` is not used by the islands and never draws.
  _view.hidden = [kind isEqualToString:@"list"];
  if (![_view.token isEqualToString:token]) {
    _view.token = token;
    [_view setNeedsDisplay];
  }
  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _view.token = @"";
  _view.kind = @"";
}

@end

Class<RCTComponentViewProtocol> MobileBenchProbeCls(void)
{
  return MBIslandProbeComponentView.class;
}
